import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getParser, parseDocument, type SourceBlock } from '../markdown/parser';
import { escapeHtml, restoreSegment } from '../markdown/protect';
import { collectTranslatableTexts, renderBlocks } from '../markdown/render';

function parse(source: string): SourceBlock[] {
	return parseDocument(getParser(), source);
}

/** 번역기가 아무것도 하지 않았다고 가정하고 그대로 되돌린다 */
function identityTranslations(blocks: readonly SourceBlock[]): Map<string, string> {
	const translations = new Map<string, string>();
	for (const text of collectTranslatableTexts(blocks)) {
		translations.set(text, text);
	}
	return translations;
}

function renderHtml(source: string): string {
	const blocks = parse(source);
	return renderBlocks(blocks, identityTranslations(blocks)).map(block => block.html).join('\n');
}

describe('front matter', () => {
	const SOURCE = [
		'---',
		'name: gitflux',
		'description: Git commit, branch, and PR conventions applied when writing messages',
		'allowed-tools: Bash, Read, Grep',
		'---',
		'',
		'# Title',
	].join('\n');

	it('키는 절대 번역 대상이 아니다', () => {
		const [frontMatter] = parse(SOURCE);
		assert.equal(frontMatter.kind, 'frontmatter');
		assert.deepEqual(frontMatter.frontMatterKeys, ['name', 'description', 'allowed-tools']);
	});

	it('식별자 값은 번역하지 않고 산문 값만 번역한다', () => {
		const [frontMatter] = parse(SOURCE);
		const translatable = frontMatter.segments.map(segment => segment.translatable);
		assert.deepEqual(translatable, [false, true, false], 'name/allowed-tools는 식별자라 번역 제외');
	});

	it('front matter 뒤의 헤딩 라인 번호가 밀리지 않는다', () => {
		const heading = parse(SOURCE).find(block => block.kind === 'heading');
		assert.equal(heading?.startLine, 6, 'front matter를 사전 스트립하면 여기가 어긋난다');
	});
});

describe('보호 대상', () => {
	it('코드펜스 본문은 번역 대상에 들어가지 않는다', () => {
		const blocks = parse('```bash\nnpm install --save-dev esbuild\n```\n');
		assert.deepEqual(collectTranslatableTexts(blocks), []);
		assert.equal(blocks[0].kind, 'code');
		assert.equal(blocks[0].lang, 'bash');
		assert.match(blocks[0].raw ?? '', /npm install/);
	});

	it('인라인 코드는 sentinel로 빠지고 자연어만 남는다', () => {
		const [block] = parse('- `feature`: Add new feature for the parser');
		const [segment] = block.segments;
		assert.equal(segment.guards.length, 1);
		assert.equal(segment.guards[0].reason, 'code');
		assert.equal(segment.masked.includes('feature`') , false);
		assert.match(segment.masked, /: Add new feature for the parser$/);
	});

	it('링크는 라벨만 번역하고 URL은 번역기에 넘기지 않는다', () => {
		const [block] = parse('See the [official guide](https://example.com/docs/a?b=1) for details');
		const [segment] = block.segments;
		assert.equal(segment.masked.includes('example.com'), false, 'href가 번역기 입력에 새면 안 된다');
		assert.match(segment.masked, /official guide/);
	});

	it('노출된 URL과 경로는 보호된다', () => {
		const [block] = parse('Read src/markdown/parser.ts and then visit https://example.com for the rest');
		const [segment] = block.segments;
		assert.equal(segment.masked.includes('parser.ts'), false);
		assert.equal(segment.masked.includes('https://'), false);
	});

	it('템플릿 변수는 보호된다', () => {
		const [block] = parse('Pass {{name}} and $ARGUMENTS into the template renderer now');
		const [segment] = block.segments;
		assert.equal(segment.masked.includes('{{name}}'), false);
		assert.equal(segment.masked.includes('$ARGUMENTS'), false);
	});

	it('자연어가 거의 없는 줄은 API를 타지 않는다', () => {
		const [block] = parse('- `--flag`: v1.2.3');
		assert.equal(block.segments[0].translatable, false);
	});
});

describe('복원', () => {
	it('sentinel 순서가 바뀌어도 조각을 되찾는다', () => {
		const [block] = parse('Run `npm install` before `npm test` to prepare the workspace');
		const [segment] = block.segments;
		// 한국어 번역은 어순이 뒤집힌다 — sentinel도 함께 이동한다
		const reordered = segment.masked.split('').reverse().join('');
		const restored = restoreSegment(reordered, segment);
		assert.equal(restored.missing.length, 0);
		assert.match(restored.html, /<code>npm install<\/code>/);
		assert.match(restored.html, /<code>npm test<\/code>/);
	});

	it('번역기가 삼킨 코드 조각은 문말에 되붙인다', () => {
		const [block] = parse('Run `npm install` to set up the project workspace');
		const [segment] = block.segments;
		const restored = restoreSegment('프로젝트 작업공간을 준비합니다', segment);
		assert.equal(restored.missing.length, 1);
		assert.match(restored.html, /tp-orphan/);
		assert.match(restored.html, /<code>npm install<\/code>/);
	});

	it('짝이 맞지 않는 강조 태그는 버려 HTML이 깨지지 않게 한다', () => {
		const [block] = parse('This is **very important** to remember');
		const [segment] = block.segments;
		// 여는 태그 sentinel만 살아남고 닫는 쪽이 사라진 상황
		const closeSentinel = String.fromCharCode(0xE000 + 1);
		const openOnly = segment.masked.split(closeSentinel).join('');
		///[-]$/u, '');
		const restored = restoreSegment(openOnly, segment);
		const openCount = (restored.html.match(/<strong>/g) ?? []).length;
		const closeCount = (restored.html.match(/<\/strong>/g) ?? []).length;
		assert.equal(openCount, closeCount, '열고 닫는 개수가 맞아야 한다');
	});

	it('번역문에 섞여 들어온 마크업은 태그가 되지 않는다', () => {
		const [block] = parse('Plain sentence that will be translated somehow');
		const [segment] = block.segments;
		const restored = restoreSegment('<img src=x onerror=alert(1)>', segment);
		assert.equal(restored.html.includes('<img'), false);
		assert.match(restored.html, /&lt;img/);
	});
});

describe('렌더', () => {
	it('헤딩 레벨이 유지된다', () => {
		assert.match(renderHtml('### Deep heading here'), /<h3>/);
	});

	it('표는 th/td와 정렬 클래스로 렌더된다', () => {
		const html = renderHtml([
			'| Name | Value |',
			'| --- | ---: |',
			'| alpha | one hundred |',
		].join('\n'));
		assert.match(html, /<table>/);
		assert.match(html, /<th[^>]*>Name<\/th>/);
		// markdown-it은 정렬을 style= 속성으로 내는데 CSP가 막으므로 클래스여야 한다
		assert.match(html, /class="ta-right"/);
		assert.equal(html.includes('style='), false, 'style= 속성은 CSP에 막힌다');
	});

	it('task list 체크 상태를 읽는다', () => {
		const blocks = parse('- [x] done item here\n- [ ] pending item here');
		assert.equal(blocks[0].checked, true);
		assert.equal(blocks[1].checked, false);
		assert.equal(blocks[0].segments[0].masked.startsWith('[x]'), false, '마커는 번역문에서 빠져야 한다');
	});

	it('raw HTML은 실행되지 않고 리터럴로 보인다', () => {
		const html = renderHtml('Some text <script>alert(1)</script> more text here');
		assert.equal(html.includes('<script>'), false);
		assert.match(html, /&lt;script&gt;/);
	});

	it('중첩 리스트 깊이를 기록한다', () => {
		const blocks = parse('- outer item text\n    - inner item text');
		const items = blocks.filter(block => block.kind === 'list_item');
		assert.equal(items[0].depth, 0);
		assert.equal(items[1].depth, 1);
	});

	it('인용문 깊이를 기록한다', () => {
		const blocks = parse('> quoted sentence goes here');
		assert.equal(blocks[0].quote, 1);
	});

	it('블록 id는 다른 곳을 편집해도 유지된다', () => {
		const before = parse('# Title here\n\nStable paragraph text.\n');
		const after = parse('# Title here\n\nNew inserted paragraph.\n\nStable paragraph text.\n');
		const stableBefore = before.find(block => block.segments[0]?.masked === 'Stable paragraph text.');
		const stableAfter = after.find(block => block.segments[0]?.masked === 'Stable paragraph text.');
		assert.equal(stableBefore?.id, stableAfter?.id, 'id가 바뀌면 DOM 패칭이 매번 전체 교체가 된다');
	});

	it('번역이 없는 블록은 원문을 보여주고 pending으로 표시된다', () => {
		const blocks = parse('A sentence that has not been translated yet.');
		const [rendered] = renderBlocks(blocks, new Map());
		assert.equal(rendered.pending, true);
		assert.match(rendered.html, /has not been translated yet/);
	});
});

describe('커서 위치 → 블록 조회', () => {
	it('라인 번호로 블록을 찾는다 (reloadAtCursor의 기반)', () => {
		const blocks = parse('# Title here\n\nFirst paragraph here.\n\nSecond paragraph here.\n');
		const atLine4 = blocks.find(block => 4 >= block.startLine && 4 < block.endLine);
		assert.equal(atLine4?.segments[0].masked, 'Second paragraph here.');
	});

	it('빈 줄에는 대응하는 블록이 없다', () => {
		const blocks = parse('# Title here\n\nParagraph here.\n');
		const atBlankLine = blocks.find(block => 1 >= block.startLine && 1 < block.endLine);
		assert.equal(atBlankLine, undefined);
	});

	it('캐시 키는 소스 라인이 아니라 마스킹된 세그먼트다', () => {
		const source = '- `feature`: Add new feature';
		const [block] = parse(source);
		// 1.5.1처럼 에디터 라인 텍스트로 캐시를 지우면 어떤 키와도 맞지 않아 조용히 실패한다
		assert.notEqual(block.segments[0].masked, source.trim());
	});
});

describe('escapeHtml', () => {
	it('HTML 특수문자를 모두 이스케이프한다', () => {
		assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
	});
});
