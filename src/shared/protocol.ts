/**
 * 확장 호스트 ↔ webview 메시지 계약. 양쪽에서 import한다.
 *
 * 이 파일은 `vscode`도 DOM도 참조하지 않는다 — 두 tsconfig가 모두 컴파일하기 때문.
 */

export type BlockKind =
	| 'frontmatter'
	| 'heading'
	| 'paragraph'
	| 'list_item'
	| 'code'
	| 'table'
	| 'hr'
	| 'html';

/**
 * 패널이 그리는 최소 단위.
 *
 * 중첩(리스트/인용)은 DOM 트리가 아니라 depth/quote 속성으로 표현한다.
 * 평평한 배열이라야 소스 라인 ↔ 화면 위치 매핑과 keyed DOM 패칭이 단순해진다.
 */
export interface PanelBlock {
	/** 내용 주소 기반 id — 다른 곳을 편집해도 바뀌지 않는다 */
	id: string;
	/** html까지 포함한 지문. 같으면 DOM을 건드리지 않는다 */
	hash: string;
	/** 0-based 소스 시작 라인. 클릭 점프와 커서 하이라이트의 기준 */
	line: number;
	endLine: number;
	kind: BlockKind;
	/** heading이면 레벨(1..6), 그 외에는 리스트 중첩 깊이 */
	depth: number;
	/** blockquote 중첩 깊이 */
	quote: number;
	/** 새니타이즈가 끝난 블록 내부 HTML */
	html: string;
	/** 리스트 마커 (•, 1., …) */
	marker?: string;
	/** task list 체크 상태 */
	checked?: boolean;
	/** 코드펜스 언어 배지 */
	lang?: string;
	/** 코드 복사 버튼이 쓸 원본 */
	raw?: string;
	/** 번역 대기 중 — 원문이 그대로 보이고 있다 */
	pending?: boolean;
}

/**
 * webview가 확장에 요청할 수 있는 동작.
 *
 * 커맨드 id를 webview가 실어 보내면 임의 커맨드 실행 채널이 된다(1.5.1의 `runCommand`).
 * 화이트리스트로 막는 대신 채널 자체를 의도(intent)로 좁히고, id 매핑은 확장이 소유한다.
 */
export type WebviewAction =
	| 'enable'
	| 'disable'
	| 'translate'
	| 'setApiKey'
	| 'setLanguage'
	| 'clearCache';

export interface NoticeAction {
	label: string;
	action: WebviewAction;
}

export type ExtToWebview =
	/** 문서 전체 교체 */
	| { type: 'render'; blocks: PanelBlock[] }
	/** 도착한 블록만 갱신 — 스크롤 위치를 지키기 위해 전체 재렌더를 피한다 */
	| { type: 'patch'; blocks: PanelBlock[] }
	/** 커서가 놓인 라인 — 강조만 한다 (스크롤은 viewport가 담당) */
	| { type: 'activeLine'; line: number }
	/** 에디터 가시 영역의 최상단 라인 — 패널을 같은 위치로 따라가게 한다 */
	| { type: 'viewport'; topLine: number }
	| { type: 'notice'; text: string; action?: NoticeAction };

export type WebviewToExt =
	| { type: 'ready' }
	/** focusEditor=false면 에디터로 이동하되 패널이 포커스를 유지한다 (읽는 흐름이 끊기지 않도록) */
	| { type: 'jumpTo'; line: number; focusEditor: boolean }
	| { type: 'action'; action: WebviewAction }
	| { type: 'openLink'; href: string }
	/** 웹뷰의 navigator.clipboard는 포커스 상태에 따라 조용히 실패한다 — 확장에 위임한다 */
	| { type: 'copy'; text: string };
