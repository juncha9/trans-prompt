import * as vscode from 'vscode';
import type { TranslationCache } from '../cache/translation-cache';
import { getParser, parseDocument } from '../markdown/parser';
import { collectTranslatableTexts, renderBlocks } from '../markdown/render';
import { GcpTranslator, TranslationError } from '../translate/gcp-translator';
import type { PanelBlock } from '../shared/protocol';
import type { TransPromptConfig } from './config-service';

/** 실행 요청 사유. 'edit'만 "이미 그 버전을 렌더했으면 건너뛴다" 최적화를 받는다 */
export type RunReason = 'enable' | 'edit' | 'config' | 'manual' | 'reload';

/** Google Translate v2가 한 요청의 `q` 배열로 받는 텍스트 개수 상한 */
const BATCH_MAX_TEXTS = 100;
/** 요청 하나의 문자 예산. 긴 문단 100개가 몰리면 요청 크기 제한에 걸린다 */
const BATCH_MAX_CHARS = 5_000;

/** 개수와 문자 수 양쪽을 지키며 청크로 나눈다 */
function chunkTexts(texts: readonly string[]): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
	let currentChars = 0;

	for (const text of texts) {
		const isFull = current.length >= BATCH_MAX_TEXTS || currentChars + text.length > BATCH_MAX_CHARS;
		if (current.length > 0 && isFull == true) {
			chunks.push(current);
			current = [];
			currentChars = 0;
		}
		current.push(text);
		currentChars += text.length;
	}
	if (current.length > 0) {
		chunks.push(current);
	}
	return chunks;
}

/**
 * 문서 하나의 번역 실행을 관리하는 상태 머신.
 *
 * dirty/translating bool 플래그를 쓰지 않는다. 1.5.1은 디바운스 콜백이 `dirty = false`를 먼저
 * 내리고 `translateDocument()`를 불렀는데, 그 시점에 이미 실행 중이면 조용히 return하면서
 * "변경됐다"는 사실 자체가 사라져 최신 편집이 화면에 반영되지 않았다.
 * 여기서는 요청을 드롭하지 않고 pending에 최신 것만 남기며(latest-wins),
 * 실제 재실행 여부는 단조 증가하는 `document.version` 비교로 판정한다.
 */
export class DocSession implements vscode.Disposable {
	private readonly document: vscode.TextDocument;
	private readonly cache: TranslationCache;
	private readonly getConfig: () => TransPromptConfig;
	private readonly emit: (blocks: PanelBlock[], full: boolean) => void;
	private readonly notify: (message: string) => void;

	private pending: RunReason | undefined;
	private running = false;
	private renderedVersion = -1;
	private disposed = false;
	/** 마지막으로 패널에 보낸 블록별 hash — 바뀐 블록만 패치하기 위해 */
	private sentHashes = new Map<string, string>();
	private abortController: AbortController | undefined;
	/**
	 * 마지막으로 사용자에게 띄운 차단성 알림.
	 * 키가 없거나 쿼터를 소진한 상태에서는 편집할 때마다 실행이 다시 돌면서 같은 토스트가
	 * 반복해서 뜬다. 같은 문구는 한 번만 보여준다.
	 */
	private lastNotice: string | undefined;

	constructor(options: {
		document: vscode.TextDocument;
		cache: TranslationCache;
		getConfig: () => TransPromptConfig;
		emit: (blocks: PanelBlock[], full: boolean) => void;
		notify: (message: string) => void;
	}) {
		this.document = options.document;
		this.cache = options.cache;
		this.getConfig = options.getConfig;
		this.emit = options.emit;
		this.notify = options.notify;
	}

	public get uri(): vscode.Uri {
		return this.document.uri;
	}

	/** 실행을 요청한다. 진행 중이면 큐에 쌓지 않고 최신 요청으로 덮어쓴다 */
	public request(reason: RunReason): void {
		if (this.disposed == true) {
			return;
		}
		this.pending = reason;
		if (this.running == true) {
			return;
		}
		void this.drain();
	}

	/** 캐시가 통째로 비워졌을 때처럼, 다음 요청이 무조건 다시 돌아야 하는 경우 */
	public invalidate(): void {
		this.renderedVersion = -1;
		this.sentHashes.clear();
		this.lastNotice = undefined;
	}

	/**
	 * 커서가 놓인 블록의 세그먼트만 캐시에서 지운다.
	 *
	 * 캐시 키는 번역기에 보낸 **마스킹된 세그먼트**이지 소스 라인이 아니다.
	 * 에디터 라인 텍스트로 지우면 어떤 키와도 맞지 않아 조용히 아무 일도 일어나지 않는다.
	 *
	 * @returns 지운 세그먼트가 하나라도 있으면 true
	 */
	public async invalidateAt(line: number): Promise<boolean> {
		const targetLanguage = this.getConfig().target_language;
		const blocks = parseDocument(getParser(), this.document.getText());
		const block = blocks.find(candidate => line >= candidate.startLine && line < candidate.endLine);
		if (block == null) {
			return false;
		}

		let removed = 0;
		for (const segment of block.segments) {
			if (segment.translatable == false) {
				continue;
			}
			await this.cache.delete(segment.masked, targetLanguage);
			removed += 1;
		}
		if (removed === 0) {
			return false;
		}

		this.renderedVersion = -1;
		this.sentHashes.clear();
		return true;
	}

	public dispose(): void {
		this.disposed = true;
		this.pending = undefined;
		// 진행 중인 fetch를 끊는다 — 탭을 옮겼는데 응답을 기다리며 매달려 있을 이유가 없다
		this.abortController?.abort();
		this.abortController = undefined;
	}

	/**
	 * 같은 문구는 다시 띄우지 않는다.
	 *
	 * 기록을 지우는 곳은 invalidate() 하나뿐이다. 실행 성공 시점에 지우면 안 된다 —
	 * 잘못된 키로는 매 실행이 키 검사를 통과한 뒤 auth 오류에서 죽으므로,
	 * 그 사이에 기록을 지우면 편집할 때마다 같은 토스트가 다시 뜬다.
	 * 설정이 바뀌면(키를 고치면) 컨트롤러가 invalidate()를 불러 기록이 정리된다.
	 */
	private notifyOnce(message: string): void {
		if (this.lastNotice === message) {
			return;
		}
		this.lastNotice = message;
		this.notify(message);
	}

	private async drain(): Promise<void> {
		this.running = true;
		try {
			while (this.pending != null && this.disposed == false) {
				const reason = this.pending;
				this.pending = undefined;
				if (reason === 'edit' && this.document.version === this.renderedVersion) {
					continue;
				}
				try {
					await this.runOnce();
				}
				catch (error) {
					console.error('[trans-prompt] translation run failed:', error);
				}
			}
		}
		finally {
			this.running = false;
		}
	}

	/**
	 * 문서를 파싱하고 번역해 패널 블록을 만든다.
	 *
	 * Flow:
	 *  1) API 키 검증
	 *  2) markdown-it으로 블록 파싱 — 각 블록이 소스 라인 범위와 세그먼트를 갖는다
	 *  3) 캐시 히트만으로 1차 렌더 (미번역 세그먼트는 원문이 그대로 보인다)
	 *  4) 캐시 미스를 청크로 나눠 번역하고, 청크가 끝날 때마다 바뀐 블록만 패치
	 *  5) 커밋 가드 — 번역 도중 문서가 바뀌었으면 남은 결과를 버리고 다음 루프에 맡긴다
	 */
	private async runOnce(): Promise<void> {
		// (1) API 키 검증
		const config = this.getConfig();
		const apiKey = config.google_api_key.trim();
		if (apiKey === '') {
			this.notifyOnce('Trans Prompt: Google API key is not configured.');
			return;
		}

		// (2) 파싱
		const startVersion = this.document.version;
		const targetLanguage = config.target_language;
		const sourceBlocks = parseDocument(getParser(), this.document.getText());

		// (3) 캐시로 채울 수 있는 만큼 먼저 그린다
		const translations = new Map<string, string>();
		const missing: string[] = [];
		for (const text of collectTranslatableTexts(sourceBlocks)) {
			const cached = this.cache.get(text, targetLanguage);
			if (cached != null) {
				translations.set(text, cached);
				continue;
			}
			missing.push(text);
		}
		this.publish(renderBlocks(sourceBlocks, translations), true);

		if (missing.length === 0) {
			this.renderedVersion = startVersion;
			return;
		}

		// (4) 청크 단위 번역 — 도착하는 대로 패치해 전체 재렌더를 피한다
		const translator = new GcpTranslator(apiKey);
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		for (const chunk of chunkTexts(missing)) {
			if (this.isStale(startVersion) == true) {
				return;
			}
			try {
				const results = await translator.translateBatch(chunk, targetLanguage, 'en', signal);
				for (let index = 0; index < chunk.length; index++) {
					translations.set(chunk[index], results[index]);
					await this.cache.set(chunk[index], targetLanguage, results[index]);
				}
			}
			catch (error: unknown) {
				if (error instanceof TranslationError == false) {
					throw error;
				}
				const failure = error as TranslationError;
				if (failure.kind === 'cancelled') {
					return;
				}
				// 키가 잘못됐거나 쿼터를 소진했으면 남은 청크도 똑같이 실패한다 — 바로 멈추고 알린다
				if (failure.kind === 'auth' || failure.kind === 'quota') {
					console.error('[trans-prompt] translation aborted:', failure.message);
					this.notifyOnce(`Trans Prompt: ${failure.message}`);
					return;
				}
				// 일시적 실패는 이 청크만 건너뛴다. 해당 블록은 원문이 남고, 에러 문구는
				// 캐시에 넣지 않는다 — 다음 실행에서 다시 시도할 수 있어야 한다
				console.error('[trans-prompt] batch translation failed:', failure.message);
			}
			if (this.isStale(startVersion) == true) {
				return;
			}
			this.publish(renderBlocks(sourceBlocks, translations), false);
		}

		// (5) 커밋 가드
		if (this.document.version === startVersion) {
			this.renderedVersion = startVersion;
		}
	}

	/**
	 * 결과를 커밋해도 되는지 판정한다.
	 * await 사이에 세션이 dispose되거나 문서가 편집됐다면 이 실행의 결과는 버려야 한다.
	 * (메서드로 빼둔 이유: 인라인 비교로 두면 TS가 앞선 가드로 `disposed`를 false로 좁혀
	 *  "겹치지 않는 비교"로 오판한다 — 실제로는 외부에서 바뀔 수 있다.)
	 */
	private isStale(startVersion: number): boolean {
		if (this.disposed == true) {
			return true;
		}
		return this.document.version !== startVersion;
	}

	/**
	 * full이면 문서 전체를 교체하고, 아니면 hash가 달라진 블록만 패치한다.
	 * 전체 재렌더는 webview 스크롤 위치를 잃게 만들므로 스트리밍 중에는 쓰지 않는다.
	 */
	private publish(blocks: PanelBlock[], full: boolean): void {
		if (full == true) {
			this.sentHashes = new Map(blocks.map(block => [block.id, block.hash]));
			this.emit(blocks, true);
			return;
		}
		const changed = blocks.filter(block => this.sentHashes.get(block.id) !== block.hash);
		if (changed.length === 0) {
			return;
		}
		for (const block of changed) {
			this.sentHashes.set(block.id, block.hash);
		}
		this.emit(changed, false);
	}
}
