import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { SegmentBuilder, escapeHtml, type Segment } from './protect';

type Token = MarkdownIt.Token;

export type BlockKind =
	| 'frontmatter'
	| 'heading'
	| 'paragraph'
	| 'list_item'
	| 'code'
	| 'table'
	| 'hr'
	| 'html';

/** 표 셀 하나의 위치/정렬. table 블록의 segments와 같은 순서로 나열된다 */
export interface CellMeta {
	readonly row: number;
	readonly header: boolean;
	readonly align: 'left' | 'center' | 'right' | null;
}

export interface SourceBlock {
	/** 내용 주소 기반 id. 다른 곳을 편집해도 바뀌지 않아 DOM 패칭 키로 쓸 수 있다 */
	readonly id: string;
	readonly kind: BlockKind;
	/** 0-based, document.lineAt()과 직접 대응 */
	readonly startLine: number;
	readonly endLine: number;
	/** heading이면 레벨(1..6), list_item이면 중첩 깊이(0부터) */
	readonly depth: number;
	/** blockquote 중첩 깊이 */
	readonly quote: number;
	readonly segments: readonly Segment[];
	readonly marker?: string;
	readonly ordered?: boolean;
	readonly checked?: boolean;
	readonly lang?: string;
	/** code / html / frontmatter의 원문 */
	readonly raw?: string;
	readonly cells?: readonly CellMeta[];
	/** frontmatter 전용: segments와 같은 순서의 키 이름 */
	readonly frontMatterKeys?: readonly string[];
}

const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * front matter를 파싱 전에 잘라내면 안 된다 — `---\nname: x\n---`를 코어가
 * thematic break + setext heading으로 오독한다. line 0에서만 발동하는 진짜 block rule로 넣어야
 * 뒤따르는 모든 토큰의 map이 절대 라인 번호를 그대로 유지한다.
 */
function frontMatterRule(md: MarkdownIt): void {
	md.block.ruler.before('table', 'front_matter', (state, startLine, endLine, silent) => {
		if (startLine !== 0) {
			return false;
		}
		const openText = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
		if (openText.trim() !== '---') {
			return false;
		}

		let closingLine = -1;
		for (let line = startLine + 1; line < endLine; line++) {
			const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
			if (text.trim() === '---') {
				closingLine = line;
				break;
			}
		}
		if (closingLine < 0) {
			return false;
		}
		if (silent === true) {
			return true;
		}

		const contentLines: string[] = [];
		for (let line = startLine + 1; line < closingLine; line++) {
			contentLines.push(state.src.slice(state.bMarks[line], state.eMarks[line]));
		}

		const token = state.push('front_matter', '', 0);
		token.markup = '---';
		token.content = contentLines.join('\n');
		token.map = [startLine, closingLine + 1];
		state.line = closingLine + 1;
		return true;
	}, { alt: [] });
}

export function createParser(): MarkdownIt {
	const md = new MarkdownIt({
		// raw HTML을 html_block/html_inline 토큰으로 만들지 않고 텍스트로 흘려보낸다.
		// 그러면 우리 가드 정규식이 잡아 번역에서 제외하고, 렌더 시 이스케이프되어
		// <system-reminder> 같은 태그가 스킬 문서에서 리터럴로 보인다 — 원하는 동작이다.
		html: false,
		linkify: true,
		// 원문의 따옴표/대시를 재작성하면 안 된다
		typographer: false,
		// softbreak를 <br>로 바꾸지 않아야 여러 줄 문단을 한 문장으로 합칠 수 있다
		breaks: false,
	});
	md.use(frontMatterRule);
	return md;
}

let sharedParser: MarkdownIt | undefined;

/** markdown-it 인스턴스는 parse 호출 간에 상태를 남기지 않으므로 하나를 공유한다 */
export function getParser(): MarkdownIt {
	if (sharedParser == null) {
		sharedParser = createParser();
	}
	return sharedParser;
}

/** 링크 대상을 분류한다. 허용 스킴이 아니면 null — href 없이 렌더해 클릭이 죽는다 */
function classifyHref(href: string | null): { href: string; kind: 'external' | 'anchor' | 'relative' } | null {
	if (href == null || href === '') {
		return null;
	}
	if (href.startsWith('#') == true) {
		return { href, kind: 'anchor' };
	}
	const schemeMatch = /^([a-zA-Z][\w+.-]*):/.exec(href);
	if (schemeMatch == null) {
		return { href, kind: 'relative' };
	}
	// javascript:, data:, vbscript: 등이 여기서 걸러진다
	if (SAFE_LINK_SCHEMES.has(schemeMatch[1].toLowerCase()) == false) {
		return null;
	}
	return { href, kind: 'external' };
}

function walkInline(children: readonly Token[], builder: SegmentBuilder): void {
	for (const child of children) {
		switch (child.type) {
			case 'text':
				builder.pushText(child.content);
				break;

			case 'softbreak':
				// 여러 줄에 걸친 한 문단을 한 문장으로 번역하기 위해 공백으로 잇는다
				builder.pushText(' ');
				break;

			case 'hardbreak':
				builder.pushGuard('<br>', '\n', 'hardbreak');
				break;

			case 'code_inline':
				builder.pushGuard(`<code>${escapeHtml(child.content)}</code>`, child.content, 'code');
				break;

			case 'strong_open':
				builder.pushGuard('<strong>', '', 'markup_open', 'strong');
				break;
			case 'strong_close':
				builder.pushGuard('</strong>', '', 'markup_close', 'strong');
				break;
			case 'em_open':
				builder.pushGuard('<em>', '', 'markup_open', 'em');
				break;
			case 'em_close':
				builder.pushGuard('</em>', '', 'markup_close', 'em');
				break;
			case 's_open':
				builder.pushGuard('<del>', '', 'markup_open', 'del');
				break;
			case 's_close':
				builder.pushGuard('</del>', '', 'markup_close', 'del');
				break;

			case 'link_open': {
				const link = classifyHref(child.attrGet('href'));
				if (link == null) {
					builder.pushGuard('<a class="tp-link-blocked">', '', 'markup_open', 'a');
					break;
				}
				builder.pushGuard(
					`<a href="${escapeHtml(link.href)}" data-kind="${link.kind}">`,
					'',
					'markup_open',
					'a'
				);
				break;
			}
			case 'link_close':
				builder.pushGuard('</a>', '', 'markup_close', 'a');
				break;

			case 'image': {
				// 패널은 원격 이미지를 로드하지 않는다. alt만 보여주고 번역 대상에서도 뺀다
				const alt = child.content;
				builder.pushGuard(`<span class="tp-img">${escapeHtml(alt)}</span>`, alt, 'image');
				break;
			}

			default:
				if (child.children != null && child.children.length > 0) {
					walkInline(child.children, builder);
					break;
				}
				if (child.content !== '') {
					builder.pushText(child.content);
				}
		}
	}
}

const TASK_LIST_PREFIX = /^\[([ xX])\]\s+/;

/** 리스트 항목 첫 텍스트의 `[ ] ` / `[x] `를 떼어내고 체크 상태를 돌려준다 */
function extractTaskState(inline: Token): boolean | undefined {
	const first = inline.children?.[0];
	if (first == null || first.type !== 'text') {
		return undefined;
	}
	const match = TASK_LIST_PREFIX.exec(first.content);
	if (match == null) {
		return undefined;
	}
	first.content = first.content.slice(match[0].length);
	return match[1].toLowerCase() === 'x';
}

/**
 * front matter를 얕은 `key: value`로 읽는다. YAML 파서를 새로 넣지 않는다 —
 * 스킬 문서의 front matter는 항상 얕고, 해석에 실패한 줄은 그냥 값 없는 키로 남긴다.
 */
function parseFrontMatter(raw: string): { key: string; value: string }[] {
	const entries: { key: string; value: string }[] = [];
	for (const line of raw.split('\n')) {
		const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
		if (match == null) {
			continue;
		}
		entries.push({ key: match[1], value: match[2].trim() });
	}
	return entries;
}

/**
 * front matter 값이 번역할 산문인지 판정한다.
 * `name: gitflux`, `allowed-tools: Read, Bash`처럼 식별자/목록인 값은 번역하면 안 된다.
 */
function isProseValue(value: string): boolean {
	if (value === '' || value.startsWith('[') == true || value.startsWith('{') == true) {
		return false;
	}
	// 쉼표로 나열된 식별자 목록 (allowed-tools 등)
	if (value.includes(',') == true && /\s/.test(value.replace(/,\s*/g, '')) == false) {
		return false;
	}
	const words = value.split(/\s+/).filter(word => /\p{L}/u.test(word) === true);
	return words.length >= 4;
}

function buildSegment(inline: Token | undefined): Segment {
	const builder = new SegmentBuilder();
	if (inline != null) {
		walkInline(inline.children ?? [], builder);
	}
	return builder.build();
}

function toAlign(style: string | null): 'left' | 'center' | 'right' | null {
	if (style == null) {
		return null;
	}
	if (style.includes('center') == true) {
		return 'center';
	}
	if (style.includes('right') == true) {
		return 'right';
	}
	if (style.includes('left') == true) {
		return 'left';
	}
	return null;
}

/**
 * 문서를 블록 배열로 파싱한다.
 *
 * Flow:
 *  1) markdown-it으로 평탄한 Token[]을 얻는다 (블록 토큰의 map이 소스 라인 범위를 준다)
 *  2) 리스트/인용 중첩은 스택으로 깊이만 추적하고, 블록 자체는 평평하게 나열한다
 *  3) 표는 셀마다 세그먼트를 만들어 한 블록에 모은다
 *  4) 같은 내용이 여러 번 나와도 구분되도록 id에 등장 순번을 붙인다
 */
export function parseDocument(md: MarkdownIt, source: string): SourceBlock[] {
	const tokens = md.parse(source, {});
	const blocks: SourceBlock[] = [];
	const occurrences = new Map<string, number>();

	const listStack: { ordered: boolean; nextOrdinal: number }[] = [];
	let quoteDepth = 0;
	let lastMap: [number, number] = [0, 0];
	let pendingItem: { depth: number; ordered: boolean; marker: string } | undefined;
	let table: { startLine: number; segments: Segment[]; cells: CellMeta[] } | undefined;
	let tableRow = -1;
	let inHeaderRow = false;
	let pendingCellAlign: 'left' | 'center' | 'right' | null = null;

	function push(block: Omit<SourceBlock, 'id'>): void {
		const fingerprint = `${block.kind} ${block.segments.map(s => s.masked).join(' ')} ${block.raw ?? ''}`;
		const digest = createHash('sha1').update(fingerprint).digest('base64url').slice(0, 10);
		const seenCount = occurrences.get(digest) ?? 0;
		occurrences.set(digest, seenCount + 1);
		blocks.push({ ...block, id: `${digest}#${seenCount}` });
	}

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.map != null) {
			lastMap = token.map;
		}
		const [startLine, endLine] = lastMap;

		switch (token.type) {
			case 'front_matter': {
				const entries = parseFrontMatter(token.content);
				const segments: Segment[] = [];
				const keys: string[] = [];
				for (const entry of entries) {
					const builder = new SegmentBuilder();
					builder.pushText(entry.value);
					segments.push(builder.build({ translatable: isProseValue(entry.value) }));
					keys.push(entry.key);
				}
				push({
					kind: 'frontmatter', startLine, endLine, depth: 0, quote: quoteDepth,
					segments, frontMatterKeys: keys, raw: token.content,
				});
				break;
			}

			case 'blockquote_open':
				quoteDepth += 1;
				break;
			case 'blockquote_close':
				quoteDepth = Math.max(0, quoteDepth - 1);
				break;

			case 'bullet_list_open':
				listStack.push({ ordered: false, nextOrdinal: 1 });
				break;
			case 'ordered_list_open': {
				const start = Number(token.attrGet('start') ?? '1');
				listStack.push({ ordered: true, nextOrdinal: Number.isFinite(start) ? start : 1 });
				break;
			}
			case 'bullet_list_close':
			case 'ordered_list_close':
				listStack.pop();
				break;

			case 'list_item_open': {
				const list = listStack[listStack.length - 1];
				if (list == null) {
					break;
				}
				let marker = '•';
				if (list.ordered == true) {
					marker = `${list.nextOrdinal}.`;
					list.nextOrdinal += 1;
				}
				pendingItem = { depth: listStack.length - 1, ordered: list.ordered, marker };
				break;
			}

			case 'heading_open':
			case 'paragraph_open':
				break;

			case 'inline': {
				const previous = tokens[index - 1];
				if (previous?.type === 'heading_open') {
					push({
						kind: 'heading', startLine, endLine, quote: quoteDepth,
						depth: Number(previous.tag.slice(1)) || 1,
						segments: [buildSegment(token)],
					});
					break;
				}
				if (pendingItem != null) {
					const checked = extractTaskState(token);
					push({
						kind: 'list_item', startLine, endLine, quote: quoteDepth,
						depth: pendingItem.depth,
						ordered: pendingItem.ordered,
						marker: pendingItem.marker,
						checked,
						segments: [buildSegment(token)],
					});
					pendingItem = undefined;
					break;
				}
				if (table != null) {
					// 표 셀은 th_open/td_open 다음에 오는 inline이다
					table.segments.push(buildSegment(token));
					table.cells.push({ row: tableRow, header: inHeaderRow, align: pendingCellAlign });
					break;
				}
				push({
					kind: 'paragraph', startLine, endLine, quote: quoteDepth,
					depth: listStack.length,
					segments: [buildSegment(token)],
				});
				break;
			}

			case 'fence':
			case 'code_block':
				push({
					kind: 'code', startLine, endLine, quote: quoteDepth,
					depth: listStack.length,
					lang: token.info.trim().split(/\s+/)[0] || undefined,
					raw: token.content,
					segments: [],
				});
				break;

			case 'hr':
				push({ kind: 'hr', startLine, endLine, depth: 0, quote: quoteDepth, segments: [] });
				break;

			case 'html_block':
				push({
					kind: 'html', startLine, endLine, quote: quoteDepth,
					depth: listStack.length, raw: token.content, segments: [],
				});
				break;

			case 'table_open':
				table = { startLine, segments: [], cells: [] };
				tableRow = -1;
				break;
			case 'thead_open':
				inHeaderRow = true;
				break;
			case 'thead_close':
				inHeaderRow = false;
				break;
			case 'tr_open':
				tableRow += 1;
				break;
			case 'th_open':
			case 'td_open':
				pendingCellAlign = toAlign(token.attrGet('style'));
				break;
			case 'table_close': {
				if (table == null) {
					break;
				}
				push({
					kind: 'table', startLine: table.startLine, endLine, quote: quoteDepth,
					depth: listStack.length,
					segments: table.segments,
					cells: table.cells,
				});
				table = undefined;
				break;
			}

			default:
				break;
		}
	}

	return blocks;
}
