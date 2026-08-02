import * as vscode from 'vscode';
import type { TranslationCache } from '../cache/translation-cache';
import type { WebviewAction } from '../shared/protocol';
import type { ConfigService } from './config-service';
import { DocSession, type RunReason } from './doc-session';
import { PanelHost } from './panel-host';

const TRANSLATE_DEBOUNCE_MS = 600;
/** 스크롤은 초당 수십 번 발화한다. 트레일링 스로틀로 postMessage 폭주를 막는다 */
const VIEWPORT_THROTTLE_MS = 40;

/**
 * webview가 보낼 수 있는 의도 → 커맨드 id 매핑.
 * webview는 커맨드 id를 모르고, 여기 없는 값은 조용히 무시된다.
 */
const ACTION_COMMANDS: Record<WebviewAction, string> = {
	enable: 'trans-prompt.enable',
	disable: 'trans-prompt.disable',
	translate: 'trans-prompt.translate',
	setApiKey: 'trans-prompt.setApiKey',
	setLanguage: 'trans-prompt.setLanguage',
	clearCache: 'trans-prompt.clearCache',
};

const EXTERNAL_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

function isMarkdown(document: vscode.TextDocument): boolean {
	return document.fileName.endsWith('.md');
}

/**
 * 에디터 이벤트와 번역 실행 사이를 중개한다.
 *
 * 소유하는 상태: 추적 중인 에디터/커서 라인, 문서 URI별 on/off, 현재 문서의 DocSession,
 * 패널 핸들, 편집 디바운스 타이머. 커맨드는 이 클래스의 public 메서드만 호출한다.
 */
export class TransPromptController implements vscode.Disposable {
	private readonly cache: TranslationCache;
	private readonly config: ConfigService;
	private readonly panelHost: PanelHost;
	private readonly disposables: vscode.Disposable[] = [];
	/** 문서 URI 단위 on/off — 탭을 다녀와도 상태가 복원되도록 */
	private readonly enabledDocuments = new Set<string>();

	private activeEditor: vscode.TextEditor | undefined;
	private activeLine: number;
	private session: DocSession | undefined;
	private debounceTimer: NodeJS.Timeout | undefined;
	private viewportTimer: NodeJS.Timeout | undefined;
	private pendingTopLine = -1;

	constructor(extensionUri: vscode.Uri, cache: TranslationCache, config: ConfigService) {
		this.cache = cache;
		this.config = config;
		this.activeEditor = vscode.window.activeTextEditor;
		this.activeLine = this.activeEditor?.selection.active.line ?? -1;

		this.panelHost = new PanelHost({
			extensionUri,
			onUserClose: () => {
				// 사용자가 X로 직접 닫았을 때만 현재 문서의 번역을 끈다
				this.disable();
			},
			onJumpTo: (uri, line, focusEditor) => {
				void this.jumpToLine(uri, line, focusEditor);
			},
			onAction: (action) => {
				const commandId = ACTION_COMMANDS[action];
				if (commandId == null) {
					return;
				}
				void vscode.commands.executeCommand(commandId);
			},
			onOpenLink: (href) => {
				void this.openLink(href);
			},
			onCopy: (text) => {
				void vscode.env.clipboard.writeText(text);
			},
		});

		this.registerListeners();
	}

	// ── 커맨드 진입점 ───────────────────────────────────────────

	public enable(): void {
		const editor = this.activeEditor;
		if (editor == null || isMarkdown(editor.document) == false) {
			return;
		}
		this.enabledDocuments.add(editor.document.uri.toString());
		void vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', true);
		// 패널이 이미 열려 있지만 다른 탭 뒤에 있으면, 켰는데 아무 일도 안 일어난 것처럼 보인다
		this.panelHost.reveal();
		this.ensureSession(editor.document).request('enable');
	}

	public disable(): void {
		const editor = this.activeEditor;
		if (editor != null) {
			this.enabledDocuments.delete(editor.document.uri.toString());
		}
		this.cancelScheduledRun();
		void vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', false);
		this.session?.dispose();
		this.session = undefined;
		this.panelHost.close();
	}

	public translate(): void {
		if (this.isEnabled() == false) {
			return;
		}
		this.session?.request('manual');
	}

	/** 커서가 놓인 블록의 캐시만 버리고 다시 번역한다 */
	public async reloadAtCursor(): Promise<void> {
		const editor = this.activeEditor;
		const session = this.session;
		if (editor == null || session == null || this.isEnabled() == false) {
			return;
		}
		const invalidated = await session.invalidateAt(editor.selection.active.line);
		if (invalidated == false) {
			return;
		}
		session.request('reload');
	}

	/**
	 * 캐시가 통째로 비워진 뒤 호출된다.
	 * 여기서 곧바로 재번역하지는 않는다 — 문서 전체가 캐시 미스가 되어 사용자가 의도하지 않은
	 * API 호출이 발생하기 때문. 다음 요청 때 다시 돌도록 표시만 해둔다.
	 */
	public handleCacheCleared(): void {
		this.session?.invalidate();
	}

	/**
	 * 창 재시작 후 VSCode가 되살려준 패널을 넘겨받는다.
	 * enabledDocuments는 메모리 상태라 이 시점엔 비어 있다 — API를 태우지 않고 안내만 띄운다.
	 */
	public adoptRestoredPanel(panel: vscode.WebviewPanel): void {
		this.panelHost.adopt(panel);
		this.showIdleNotice();
	}

	public dispose(): void {
		this.cancelScheduledRun();
		if (this.viewportTimer != null) {
			clearTimeout(this.viewportTimer);
			this.viewportTimer = undefined;
		}
		this.session?.dispose();
		this.panelHost.dispose();
		while (this.disposables.length > 0) {
			this.disposables.pop()?.dispose();
		}
	}

	// ── 내부 ────────────────────────────────────────────────────

	private registerListeners(): void {
		this.disposables.push(
			// editor == null은 webview/터미널로 포커스가 옮겨간 일시 상태다.
			// 여기서 상태를 지우면 패널을 클릭하는 것만으로 번역이 꺼진다.
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor == null) {
					return;
				}
				this.handleActiveEditorChanged(editor);
			}),

			vscode.workspace.onDidCloseTextDocument((document) => {
				this.enabledDocuments.delete(document.uri.toString());
			}),

			vscode.window.onDidChangeTextEditorSelection((event) => {
				if (event.textEditor !== this.activeEditor) {
					return;
				}
				const line = event.selections[0].active.line;
				if (line === this.activeLine) {
					return;
				}
				this.activeLine = line;
				const panelUri = this.panelHost.targetUri;
				if (panelUri == null || event.textEditor.document.uri.toString() !== panelUri.toString()) {
					return;
				}
				this.panelHost.setActiveLine(line);
			}),

			// 1.5.1의 README는 "synced with editor scroll"이라고 적혀 있었지만 실제로는
			// 커서 싱크뿐이었다 (이 이벤트를 구독하지 않았다). 여기서 실제로 맞춘다.
			vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
				if (event.textEditor !== this.activeEditor || this.isEnabled() == false) {
					return;
				}
				const topRange = event.visibleRanges[0];
				if (topRange == null) {
					return;
				}
				this.scheduleViewportSync(topRange.start.line);
			}),

			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.activeEditor == null || event.document !== this.activeEditor.document) {
					return;
				}
				if (isMarkdown(event.document) == false || this.isEnabled() == false) {
					return;
				}
				this.scheduleRun('edit');
			}),

			this.config.onDidChange(() => {
				if (this.isEnabled() == false) {
					return;
				}
				this.session?.invalidate();
				this.session?.request('config');
			}),
		);
	}

	private handleActiveEditorChanged(editor: vscode.TextEditor): void {
		this.activeEditor = editor;
		this.activeLine = editor.selection.active.line;
		this.cancelScheduledRun();
		this.session?.dispose();
		this.session = undefined;

		const enabled = this.enabledDocuments.has(editor.document.uri.toString());
		void vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', enabled);
		if (enabled == true) {
			this.ensureSession(editor.document).request('enable');
			return;
		}
		if (this.panelHost.isOpen == false) {
			return;
		}
		this.showIdleNotice();
	}

	private showIdleNotice(): void {
		const editor = this.activeEditor;
		if (editor == null || isMarkdown(editor.document) == false) {
			this.panelHost.showNotice(editor?.document.uri, 'Open a Markdown (.md) document to see translations.');
			return;
		}
		this.panelHost.showNotice(
			editor.document.uri,
			'Translation is not enabled for this document.',
			{ label: 'Enable Translation', action: 'enable' }
		);
	}

	private ensureSession(document: vscode.TextDocument): DocSession {
		if (this.session != null && this.session.uri.toString() === document.uri.toString()) {
			return this.session;
		}
		this.session?.dispose();
		this.session = new DocSession({
			document,
			cache: this.cache,
			getConfig: () => this.config.current,
			emit: (blocks, full) => {
				this.panelHost.update(document.uri, blocks, full, this.activeLine);
			},
			notify: (message) => {
				void vscode.window.showWarningMessage(message);
			},
		});
		return this.session;
	}

	private isEnabled(): boolean {
		const editor = this.activeEditor;
		if (editor == null) {
			return false;
		}
		return this.enabledDocuments.has(editor.document.uri.toString());
	}

	private scheduleRun(reason: RunReason): void {
		this.cancelScheduledRun();
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined;
			const editor = this.activeEditor;
			if (editor == null || this.isEnabled() == false) {
				return;
			}
			this.ensureSession(editor.document).request(reason);
		}, TRANSLATE_DEBOUNCE_MS);
	}

	private cancelScheduledRun(): void {
		if (this.debounceTimer == null) {
			return;
		}
		clearTimeout(this.debounceTimer);
		this.debounceTimer = undefined;
	}

	/** 트레일링 스로틀 — 타이머가 이미 떠 있으면 최신 라인만 갱신하고 그대로 둔다 */
	private scheduleViewportSync(topLine: number): void {
		this.pendingTopLine = topLine;
		if (this.viewportTimer != null) {
			return;
		}
		this.viewportTimer = setTimeout(() => {
			this.viewportTimer = undefined;
			const panelUri = this.panelHost.targetUri;
			if (panelUri == null || this.activeEditor?.document.uri.toString() !== panelUri.toString()) {
				return;
			}
			this.panelHost.setViewport(this.pendingTopLine);
		}, VIEWPORT_THROTTLE_MS);
	}

	private async openLink(href: string): Promise<void> {
		// 문서 내 앵커는 아직 대상이 없다 (헤딩 앵커는 미구현)
		if (href.startsWith('#') == true) {
			return;
		}

		// 스킴이 없으면 패널이 보고 있는 문서 기준의 상대 경로다 — 스킬 문서가 형제 파일을 자주 건다
		const schemeMatch = /^([a-zA-Z][\w+.-]*):/.exec(href);
		if (schemeMatch == null) {
			const baseUri = this.panelHost.targetUri;
			if (baseUri == null) {
				return;
			}
			const targetUri = vscode.Uri.joinPath(baseUri, '..', href.split('#')[0]);
			try {
				const document = await vscode.workspace.openTextDocument(targetUri);
				await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
			}
			catch (error) {
				console.error('[trans-prompt] failed to open linked document:', error);
			}
			return;
		}

		// javascript:, data:, vbscript: 등은 여기서 걸러진다
		if (EXTERNAL_LINK_SCHEMES.has(schemeMatch[1].toLowerCase()) == false) {
			return;
		}
		await vscode.env.openExternal(vscode.Uri.parse(href));
	}

	/**
	 * 패널 행 클릭 → 에디터 이동.
	 * focusEditor=false(단일 클릭)면 패널이 포커스를 유지한다. 1.5.1은 항상 포커스를 뺏어
	 * 읽는 도중 행을 누를 때마다 에디터로 끌려갔다.
	 */
	private async jumpToLine(uri: vscode.Uri, line: number, focusEditor: boolean): Promise<void> {
		const preserveFocus = focusEditor == false;
		const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());

		let target: vscode.TextEditor;
		if (visible == null) {
			const document = await vscode.workspace.openTextDocument(uri);
			target = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus });
		}
		else {
			target = await vscode.window.showTextDocument(visible.document, { viewColumn: visible.viewColumn, preserveFocus });
		}

		const safeLine = Math.max(0, Math.min(line, target.document.lineCount - 1));
		const text = target.document.lineAt(safeLine).text;
		const column = text.length - text.trimStart().length;
		const position = new vscode.Position(safeLine, column);
		target.selection = new vscode.Selection(position, position);
		target.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
	}
}
