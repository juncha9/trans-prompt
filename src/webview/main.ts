import type { ExtToWebview, NoticeAction, PanelBlock, WebviewToExt } from '../shared/protocol';

declare function acquireVsCodeApi(): {
	postMessage(message: WebviewToExt): void;
	getState(): unknown;
	setState(state: unknown): void;
};

const vscodeApi = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

interface MountedBlock {
	readonly element: HTMLElement;
	block: PanelBlock;
}

/** 블록 id → 마운트된 DOM. 내용 주소 id라 다른 곳을 편집해도 그대로 살아남는다 */
let mounted = new Map<string, MountedBlock>();
/** 소스 라인 오름차순으로 정렬된 [line, id] — 커서 하이라이트 폴백 탐색용 */
let lineIndex: { line: number; id: string }[] = [];
let activeLine = -1;
let container: HTMLElement | undefined;

function post(message: WebviewToExt): void {
	vscodeApi.postMessage(message);
}

function applyBlockAttributes(element: HTMLElement, block: PanelBlock): void {
	element.className = 'tp-block';
	element.dataset.kind = block.kind;
	element.dataset.line = String(block.line);
	element.dataset.depth = String(Math.min(block.depth, 6));
	element.dataset.quote = String(Math.min(block.quote, 4));
	if (block.pending === true) {
		element.dataset.pending = 'true';
		return;
	}
	delete element.dataset.pending;
}

function wireBlock(element: HTMLElement, block: PanelBlock): void {
	const copyButton = element.querySelector('.tp-code-copy');
	if (copyButton == null || block.raw == null) {
		return;
	}
	// 웹뷰의 navigator.clipboard는 포커스 상태에 따라 조용히 실패한다. 확장에 위임한다
	copyButton.addEventListener('click', (event) => {
		event.stopPropagation();
		post({ type: 'copy', text: block.raw ?? '' });
	});
}

function createBlockElement(block: PanelBlock): HTMLElement {
	const element = document.createElement('div');
	applyBlockAttributes(element, block);
	element.innerHTML = block.html;
	wireBlock(element, block);
	// 단일 클릭은 에디터를 옮기되 패널 포커스를 유지한다. 더블 클릭이면 에디터로 넘어간다
	element.addEventListener('click', (event) => {
		post({ type: 'jumpTo', line: block.line, focusEditor: event.detail >= 2 });
	});
	return element;
}

function rebuildLineIndex(): void {
	lineIndex = [];
	for (const [id, entry] of mounted) {
		lineIndex.push({ line: entry.block.line, id });
	}
	lineIndex.sort((a, b) => a.line - b.line);
}

/** 주어진 소스 라인을 품은 블록 id. 정확히 대응하는 블록이 없으면 그보다 앞선 가장 가까운 블록 */
function findBlockIdForLine(line: number): string | undefined {
	let found: string | undefined;
	for (const entry of lineIndex) {
		if (entry.line > line) {
			break;
		}
		found = entry.id;
	}
	return found;
}

/**
 * 커서 라인을 품은 블록을 강조한다. **스크롤은 하지 않는다** —
 * 스크롤은 viewport 메시지가 담당한다. 둘 다 스크롤하면 애니메이션이 서로 싸운다.
 */
function applyActive(): void {
	const targetId = findBlockIdForLine(activeLine);
	for (const [id, entry] of mounted) {
		entry.element.classList.toggle('active', id === targetId);
	}
}

/**
 * 에디터 가시 영역의 최상단 라인에 패널을 맞춘다.
 *
 * behavior는 'auto'다. 연속 스크롤에 'smooth'를 걸면 애니메이션이 계속 재시작되며 끌린다.
 * 패널 → 에디터 방향은 보내지 않으므로 에코 루프가 생기지 않는다.
 */
function applyViewport(topLine: number): void {
	const targetId = findBlockIdForLine(topLine);
	if (targetId == null) {
		return;
	}
	const element = mounted.get(targetId)?.element;
	if (element == null) {
		return;
	}
	const offset = element.getBoundingClientRect().top;
	if (Math.abs(offset) < 2) {
		return;
	}
	window.scrollBy({ top: offset - 12, behavior: 'auto' });
}

/** 문서 전체 교체 */
function renderAll(blocks: PanelBlock[]): void {
	mounted = new Map();

	if (blocks.length === 0) {
		renderNotice('No translatable content.');
		return;
	}

	container = document.createElement('div');
	container.className = 'reader';
	for (const block of blocks) {
		const element = createBlockElement(block);
		container.appendChild(element);
		mounted.set(block.id, { element, block });
	}
	root.replaceChildren(container);
	rebuildLineIndex();
	applyActive();
}

/**
 * 도착한 블록만 갈아끼운다.
 *
 * 엘리먼트 노드는 유지하고 내부만 교체해야 스크롤 앵커가 살아남는다.
 * 패치 전후로 최상단 가시 블록의 오프셋을 기록/복원해, 위쪽 블록의 높이가 변해도
 * 읽던 자리가 그대로 있게 한다.
 */
function patchBlocks(blocks: PanelBlock[]): void {
	// patch는 직전 render가 넘긴 블록의 부분집합이다. 문서가 없는 상태(안내 화면 등)에서
	// 이걸 전체 렌더로 돌리면 문서 일부만 그려진 화면이 된다. 무시하고 다음 render를 기다린다
	if (container == null) {
		return;
	}

	const anchor = findScrollAnchor();

	for (const block of blocks) {
		const existing = mounted.get(block.id);
		if (existing == null) {
			// 알 수 없는 id — 전체 렌더와 어긋났다는 뜻이므로 패치를 포기한다
			continue;
		}
		applyBlockAttributes(existing.element, block);
		existing.element.innerHTML = block.html;
		wireBlock(existing.element, block);
		existing.block = block;
	}

	restoreScrollAnchor(anchor);
}

function findScrollAnchor(): { id: string; offset: number } | undefined {
	for (const entry of lineIndex) {
		const item = mounted.get(entry.id);
		if (item == null) {
			continue;
		}
		const top = item.element.getBoundingClientRect().top;
		if (top >= 0) {
			return { id: entry.id, offset: top };
		}
	}
	return undefined;
}

function restoreScrollAnchor(anchor: { id: string; offset: number } | undefined): void {
	if (anchor == null) {
		return;
	}
	const item = mounted.get(anchor.id);
	if (item == null) {
		return;
	}
	const currentTop = item.element.getBoundingClientRect().top;
	const drift = currentTop - anchor.offset;
	if (drift === 0) {
		return;
	}
	window.scrollBy(0, drift);
}

function renderNotice(text: string, action?: NoticeAction): void {
	mounted = new Map();
	lineIndex = [];
	container = undefined;

	const wrapper = document.createElement('div');
	wrapper.className = 'empty';

	const label = document.createElement('div');
	label.textContent = text;
	wrapper.appendChild(label);

	if (action != null) {
		const button = document.createElement('button');
		button.className = 'action-btn';
		button.textContent = action.label;
		button.addEventListener('click', () => {
			post({ type: 'action', action: action.action });
		});
		wrapper.appendChild(button);
	}

	root.replaceChildren(wrapper);
}

// 링크는 브라우저 기본 동작에 맡기지 않는다. default-src 'none' 아래에서 앵커 동작이
// 일관되지 않고, 스킴 검증과 상대경로 해석은 확장 쪽에서 해야 하기 때문.
document.addEventListener('click', (event) => {
	const target = event.target as HTMLElement | null;
	const anchor = target?.closest('a');
	if (anchor == null) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const href = anchor.getAttribute('href');
	if (href == null || href === '') {
		return;
	}
	post({ type: 'openLink', href });
});

window.addEventListener('message', (event: MessageEvent<ExtToWebview>) => {
	const message = event.data;
	if (message.type === 'render') {
		renderAll(message.blocks);
		return;
	}
	if (message.type === 'patch') {
		patchBlocks(message.blocks);
		return;
	}
	if (message.type === 'activeLine') {
		activeLine = message.line;
		applyActive();
		return;
	}
	if (message.type === 'viewport') {
		applyViewport(message.topLine);
		return;
	}
	if (message.type === 'notice') {
		renderNotice(message.text, message.action);
	}
});

post({ type: 'ready' });
