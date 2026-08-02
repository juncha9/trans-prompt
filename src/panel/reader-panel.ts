import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ExtToWebview, NoticeAction, PanelBlock, WebviewAction, WebviewToExt } from '../shared/protocol';

export const PANEL_VIEW_TYPE = 'transPromptPanel';

export interface ReaderPanelCallbacks {
	onDispose: () => void;
	onJumpTo: (line: number, focusEditor: boolean) => void;
	onAction: (action: WebviewAction) => void;
	onOpenLink: (href: string) => void;
	onCopy: (text: string) => void;
}

/** webview가 접근할 수 있는 로컬 리소스를 확장 디렉터리 안으로 제한한다 */
function buildWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
	return {
		enableScripts: true,
		enableCommandUris: false,
		localResourceRoots: [
			vscode.Uri.joinPath(extensionUri, 'media'),
			vscode.Uri.joinPath(extensionUri, 'dist'),
		],
	};
}

/**
 * 번역 결과를 보여주는 사이드 webview 패널. 동시에 하나만 존재한다.
 *
 * HTML은 CSP + nonce가 걸린 셸뿐이고, 스타일과 스크립트는 asWebviewUri로 불러온다.
 * webview가 스크립트를 올리기 전에 도착한 메시지는 'ready'를 받을 때까지 큐에 담아둔다 —
 * 외부 스크립트는 인라인 스크립트보다 늦게 실행되므로 이 창을 놓치면 첫 렌더가 통째로 사라진다.
 */
export class ReaderPanel implements vscode.Disposable {
	public static currentPanel: ReaderPanel | undefined;

	private readonly panel: vscode.WebviewPanel;
	private readonly disposables: vscode.Disposable[] = [];
	private callbacks: ReaderPanelCallbacks | undefined;
	private queued: ExtToWebview[] = [];
	private ready = false;

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, callbacks: ReaderPanelCallbacks) {
		this.panel = panel;
		this.callbacks = callbacks;
		this.panel.webview.options = buildWebviewOptions(extensionUri);
		this.panel.webview.html = this.buildHtml(extensionUri);

		this.panel.onDidDispose(() => {
			this.dispose();
		}, null, this.disposables);

		this.panel.webview.onDidReceiveMessage((message: WebviewToExt) => {
			this.handleMessage(message);
		}, null, this.disposables);
	}

	public static showOrCreate(extensionUri: vscode.Uri, callbacks: ReaderPanelCallbacks): ReaderPanel {
		if (ReaderPanel.currentPanel != null) {
			ReaderPanel.currentPanel.callbacks = callbacks;
			ReaderPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
			return ReaderPanel.currentPanel;
		}
		const panel = vscode.window.createWebviewPanel(
			PANEL_VIEW_TYPE,
			'Trans Prompt',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ ...buildWebviewOptions(extensionUri), retainContextWhenHidden: true }
		);
		ReaderPanel.currentPanel = new ReaderPanel(panel, extensionUri, callbacks);
		return ReaderPanel.currentPanel;
	}

	/** 창 재시작 후 VSCode가 되살려준 패널을 다시 붙인다 (WebviewPanelSerializer 경로) */
	public static restore(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, callbacks: ReaderPanelCallbacks): ReaderPanel {
		ReaderPanel.currentPanel?.dispose();
		ReaderPanel.currentPanel = new ReaderPanel(panel, extensionUri, callbacks);
		return ReaderPanel.currentPanel;
	}

	/** preserveFocus: 에디터에서 타이핑하던 흐름을 끊지 않는다 */
	public reveal(): void {
		this.panel.reveal(vscode.ViewColumn.Beside, true);
	}

	public render(blocks: PanelBlock[]): void {
		this.post({ type: 'render', blocks });
	}

	/** 바뀐 블록만 갱신한다 — 전체 교체는 읽던 스크롤 위치를 잃는다 */
	public patch(blocks: PanelBlock[]): void {
		this.post({ type: 'patch', blocks });
	}

	public setActiveLine(line: number): void {
		this.post({ type: 'activeLine', line });
	}

	public setViewport(topLine: number): void {
		this.post({ type: 'viewport', topLine });
	}

	public showNotice(text: string, action?: NoticeAction): void {
		this.post({ type: 'notice', text, action });
	}

	public dispose(): void {
		if (ReaderPanel.currentPanel === this) {
			ReaderPanel.currentPanel = undefined;
		}
		const notifyDispose = this.callbacks?.onDispose;
		this.callbacks = undefined;
		this.queued = [];

		this.panel.dispose();
		while (this.disposables.length > 0) {
			this.disposables.pop()?.dispose();
		}
		notifyDispose?.();
	}

	private post(message: ExtToWebview): void {
		if (this.ready == false) {
			this.queued.push(message);
			return;
		}
		void this.panel.webview.postMessage(message);
	}

	private handleMessage(message: WebviewToExt): void {
		if (message == null) {
			return;
		}
		if (message.type === 'ready') {
			this.ready = true;
			const pending = this.queued;
			this.queued = [];
			for (const queuedMessage of pending) {
				void this.panel.webview.postMessage(queuedMessage);
			}
			return;
		}
		if (message.type === 'jumpTo') {
			this.callbacks?.onJumpTo(message.line, message.focusEditor);
			return;
		}
		if (message.type === 'action') {
			this.callbacks?.onAction(message.action);
			return;
		}
		if (message.type === 'openLink') {
			this.callbacks?.onOpenLink(message.href);
			return;
		}
		if (message.type === 'copy') {
			this.callbacks?.onCopy(message.text);
		}
	}

	private buildHtml(extensionUri: vscode.Uri): string {
		const webview = this.panel.webview;
		const nonce = randomBytes(16).toString('base64');
		const shellStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'panel.css'));
		const markdownStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'markdown.css'));
		const highlightStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'highlight.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'panel.js'));

		// style-src에 nonce도 unsafe-inline도 주지 않는다 — CSS는 전부 외부 파일이므로 cspSource로 충분하다.
		// connect-src 'none': webview는 아무것도 fetch하지 않는다. 데이터는 postMessage로만 들어온다.
		const contentSecurityPolicy = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} https: data:`,
			`font-src ${webview.cspSource}`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`connect-src 'none'`,
		].join('; ');

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${shellStyleUri}">
<link rel="stylesheet" href="${markdownStyleUri}">
<link rel="stylesheet" href="${highlightStyleUri}">
<title>Trans Prompt</title>
</head>
<body>
<div id="root"><div class="empty">Waiting for translations…</div></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
