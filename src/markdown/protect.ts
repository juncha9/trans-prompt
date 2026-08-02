/**
 * 번역기에 자연어만 보내고 마크다운 구조는 원형 그대로 되돌리기 위한 마스킹 계층.
 *
 * 보호 조각 하나 = 사설 영역(Private Use Area) 문자 **한 글자**.
 * `{0}` 같은 다문자 델리미터는 번역기가 중간을 쪼개거나 숫자를 로케일별로 재포맷할 수 있고,
 * 한쪽만 살아남으면 복구가 불가능한 상태가 된다. 한 글자는 상태가 "생존 / 소실 / 이동" 셋뿐이라
 * 스캔 한 번으로 전부 검출되고, 어순이 바뀌어도 index로 복원되며, 과금 code point가 1이다.
 */

const SENTINEL_BASE = 0xE000;
/** PUA U+E000~U+E0FF — 세그먼트 하나가 가질 수 있는 보호 조각 상한 */
const SENTINEL_CAPACITY = 256;

/**
 * sentinel 스캐너는 호출할 때마다 새로 만든다.
 * /g 정규식은 lastIndex를 들고 다니므로, 하나를 exec와 replace가 나눠 쓰면 서로의 위치를 망가뜨린다.
 */
function createSentinelScanner(): RegExp {
	return new RegExp('[\\uE000-\\uE0FF]', 'g');
}

function toSentinel(index: number): string {
	return String.fromCharCode(SENTINEL_BASE + index);
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

export function escapeHtml(input: string): string {
	return input.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

export type GuardReason =
	| 'code'
	| 'image'
	| 'hardbreak'
	| 'html'
	| 'template_var'
	| 'url'
	| 'path'
	| 'markup_open'
	| 'markup_close';

export interface Guard {
	readonly index: number;
	readonly reason: GuardReason;
	/** 복원 시 삽입할 HTML (이미 이스케이프/새니타이즈 완료) */
	readonly html: string;
	/** 조각이 유실됐을 때 쓸 평문 */
	readonly text: string;
	/** markup_open/close의 태그 이름 — 짝 맞추기에 쓴다 */
	readonly tag?: string;
}

export interface Segment {
	/** 번역기에 실제로 보낼 문자열. 보호 조각은 sentinel 한 글자로 치환돼 있다 */
	readonly masked: string;
	readonly guards: readonly Guard[];
	/** false면 API를 태우지 않는다 — 자연어가 사실상 없는 줄 */
	readonly translatable: boolean;
}

/**
 * `text` 토큰 내부에서 추가로 보호할 패턴.
 *
 * 잘 쓰인 md에서 식별자는 대부분 백틱 안에 있어 구조적으로 이미 빠지므로 목록을 작게 유지한다.
 * 과잉 마스킹은 문장을 조각내 오히려 번역 품질을 떨어뜨린다.
 * `trans-prompt.enable` 같은 dotted identifier는 `e.g.`/문장 끝 마침표와 구분이 어려워 제외했다.
 */
const GUARD_PATTERNS: readonly { reason: GuardReason; pattern: RegExp }[] = [
	// html:false로 파싱하면 raw HTML이 text 토큰으로 흘러든다. 잡지 않으면 태그가 번역된다
	{ reason: 'html', pattern: /<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?>/g },
	{ reason: 'template_var', pattern: /\{\{[^}]*\}\}|\$\{[^}]*\}|\$[A-Z][A-Z0-9_]{2,}/g },
	{ reason: 'url', pattern: /https?:\/\/[^\s<>)\]]+|[\w.+-]+@[\w-]+\.[\w.]+/g },
	{ reason: 'path', pattern: /(?:\.{0,2}\/|~\/)[\w./@-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|json|jsonc|md|py|yml|yaml|sh|bat|ps1|toml|css|scss|html)\b/g },
];

/** 유실되면 정보 손실이 큰 조각 — 복원 실패 시 문말에라도 덧붙인다 */
const CRITICAL_REASONS = new Set<GuardReason>(['code', 'url', 'path', 'template_var']);

/**
 * 한 블록의 인라인 내용을 훑으며 세그먼트를 조립한다.
 * 파서가 토큰을 순회하면서 자연어는 pushText로, 구조는 pushGuard로 밀어넣는다.
 */
export class SegmentBuilder {
	private readonly parts: string[] = [];
	private readonly guards: Guard[] = [];

	/** 자연어 조각 — 내부의 URL/경로/템플릿 변수/raw HTML은 여기서 다시 보호된다 */
	public pushText(text: string): void {
		if (text === '') {
			return;
		}

		// 패턴별 매치를 모아 시작 위치로 정렬하고, 겹치는 구간은 먼저 잡은 쪽(더 긴 쪽)을 남긴다
		const spans: { start: number; end: number; reason: GuardReason }[] = [];
		for (const rule of GUARD_PATTERNS) {
			const scanner = new RegExp(rule.pattern.source, rule.pattern.flags);
			let match: RegExpExecArray | null = scanner.exec(text);
			while (match != null) {
				spans.push({ start: match.index, end: match.index + match[0].length, reason: rule.reason });
				match = scanner.exec(text);
			}
		}
		spans.sort((a, b) => a.start - b.start || b.end - a.end);

		let cursor = 0;
		for (const span of spans) {
			if (span.start < cursor) {
				continue;
			}
			this.parts.push(text.slice(cursor, span.start));
			const raw = text.slice(span.start, span.end);
			this.pushGuard(escapeHtml(raw), raw, span.reason);
			cursor = span.end;
		}
		this.parts.push(text.slice(cursor));
	}

	/**
	 * 통째로 보호할 조각을 넣고 sentinel로 치환한다.
	 * 상한을 넘으면 보호를 포기하고 평문으로 흘려보낸다 — 범위 밖 sentinel을 만드는 것보다 낫다.
	 */
	public pushGuard(html: string, text: string, reason: GuardReason, tag?: string): void {
		if (this.guards.length >= SENTINEL_CAPACITY) {
			this.parts.push(text);
			return;
		}
		const index = this.guards.length;
		this.guards.push({ index, reason, html, text, tag });
		this.parts.push(toSentinel(index));
	}

	/**
	 * @param options.translatable false를 주면 자연어 판정과 무관하게 번역을 건너뛴다.
	 *   front matter의 `name: gitflux`처럼 문법적으로는 단어지만 식별자인 값에 쓴다.
	 */
	public build(options?: { translatable?: boolean }): Segment {
		const masked = this.parts.join('');
		if (options?.translatable === false) {
			return { masked, guards: this.guards, translatable: false };
		}
		return { masked, guards: this.guards, translatable: isTranslatable(masked) };
	}
}

/**
 * 번역기를 태울 가치가 있는 문자열인지 판정한다.
 * `- \`--flag\`: v1.2.3`처럼 보호 조각과 기호만 남는 줄은 API를 타지 않고 그대로 렌더된다.
 */
function isTranslatable(masked: string): boolean {
	const bare = masked.replace(createSentinelScanner(), ' ');
	const letters = bare.match(/\p{L}/gu);
	if (letters == null || letters.length < 3) {
		return false;
	}
	return true;
}

export interface RestoreResult {
	readonly html: string;
	/** 번역 결과에서 사라진 보호 조각 index */
	readonly missing: readonly number[];
}

/**
 * 번역문의 sentinel을 원래 조각으로 되돌려 인라인 HTML을 만든다.
 *
 * 자연어 부분은 전부 이스케이프하므로, 번역기가 마크업을 되돌려주더라도 그대로 태그가 되지 않는다.
 * 강조 태그는 스택으로 짝을 맞춘다 — 짝 없는 닫기는 버리고, 닫히지 않은 열기는 끝에서 닫는다.
 */
export function restoreSegment(translated: string, segment: Segment): RestoreResult {
	const guardsByIndex = new Map(segment.guards.map(guard => [guard.index, guard]));
	const seen = new Set<number>();
	const openTags: string[] = [];
	const output: string[] = [];
	const scanner = createSentinelScanner();

	let cursor = 0;
	let match: RegExpExecArray | null = scanner.exec(translated);
	while (match != null) {
		output.push(escapeHtml(translated.slice(cursor, match.index)));
		cursor = match.index + 1;

		const guard = guardsByIndex.get(match[0].charCodeAt(0) - SENTINEL_BASE);
		match = scanner.exec(translated);

		if (guard == null) {
			// 우리가 넣지 않은 PUA 문자 — 번역기가 만들어낸 것이므로 버린다
			continue;
		}
		if (seen.has(guard.index) == true) {
			// 번역기가 조각을 복제했다. 강조 태그가 중복되면 구조가 깨지므로 첫 번째만 살린다
			continue;
		}
		seen.add(guard.index);

		if (guard.reason === 'markup_open') {
			openTags.push(guard.tag ?? '');
			output.push(guard.html);
			continue;
		}
		if (guard.reason === 'markup_close') {
			if (openTags.length === 0 || openTags[openTags.length - 1] !== guard.tag) {
				continue;
			}
			openTags.pop();
			output.push(guard.html);
			continue;
		}
		output.push(guard.html);
	}
	output.push(escapeHtml(translated.slice(cursor)));

	while (openTags.length > 0) {
		output.push(`</${openTags.pop()}>`);
	}

	// 유실된 조각 중 정보 손실이 큰 것만 문말에 덧붙인다 (강조 태그 등은 그냥 버린다)
	const missing: number[] = [];
	for (const guard of segment.guards) {
		if (seen.has(guard.index) == true) {
			continue;
		}
		missing.push(guard.index);
		if (CRITICAL_REASONS.has(guard.reason) == false) {
			continue;
		}
		output.push(` <span class="tp-orphan">${guard.html}</span>`);
	}

	return { html: output.join(''), missing };
}

/** 번역을 건너뛴(또는 실패한) 세그먼트를 원문 그대로 렌더한다 */
export function renderSegmentAsSource(segment: Segment): string {
	return restoreSegment(segment.masked, segment).html;
}
