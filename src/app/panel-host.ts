import * as vscode from 'vscode';
import { ReaderPanel, type ReaderPanelCallbacks } from '../panel/reader-panel';
import type { NoticeAction, PanelBlock, WebviewAction } from '../shared/protocol';

/**
 * 사이드 패널의 수명주기와 "누가 닫았는가"를 관리한다.
 *
 * 패널은 사용자가 X로 직접 닫을 수도, 우리가 disable/종료 과정에서 닫을 수도 있다.
 * 전자만 현재 문서의 번역을 끄는 동작으로 이어져야 하므로 suppressNextDispose로 구분한다.
 */
export class PanelHost implements vscode.Disposable {
	private readonly extensionUri: vscode.Uri;
	private readonly onUserClose: () => void;
	private readonly onJumpTo: (uri: vscode.Uri, line: number, focusEditor: boolean) => void;
	private readonly onAction: (action: WebviewAction) => void;
	private readonly onOpenLink: (href: string) => void;
	private readonly onCopy: (text: string) => void;

	private panel: ReaderPanel | undefined;
	/** 패널이 마지막으로 렌더한 문서. 패널 클릭 시 webview가 포커스를 가져가 activeTextEditor가 비므로 필요하다 */
	private documentUri: vscode.Uri | undefined;
	private suppressNextDispose = false;

	constructor(options: {
		extensionUri: vscode.Uri;
		onUserClose: () => void;
		onJumpTo: (uri: vscode.Uri, line: number, focusEditor: boolean) => void;
		onAction: (action: WebviewAction) => void;
		onOpenLink: (href: string) => void;
		onCopy: (text: string) => void;
	}) {
		this.extensionUri = options.extensionUri;
		this.onUserClose = options.onUserClose;
		this.onJumpTo = options.onJumpTo;
		this.onAction = options.onAction;
		this.onOpenLink = options.onOpenLink;
		this.onCopy = options.onCopy;
	}

	public get isOpen(): boolean {
		return this.panel != null;
	}

	public get targetUri(): vscode.Uri | undefined {
		return this.documentUri;
	}

	public update(documentUri: vscode.Uri, blocks: PanelBlock[], full: boolean, activeLine: number): void {
		this.documentUri = documentUri;
		const panel = this.ensure();
		if (full == true) {
			panel.render(blocks);
			panel.setActiveLine(activeLine);
			return;
		}
		panel.patch(blocks);
	}

	public setActiveLine(line: number): void {
		this.panel?.setActiveLine(line);
	}

	public setViewport(topLine: number): void {
		this.panel?.setViewport(topLine);
	}

	public showNotice(documentUri: vscode.Uri | undefined, text: string, action?: NoticeAction): void {
		if (this.panel == null) {
			return;
		}
		this.documentUri = documentUri;
		this.panel.showNotice(text, action);
	}

	/**
	 * 창 재시작 후 VSCode가 되살려준 패널을 넘겨받는다.
	 *
	 * 이미 패널을 들고 있다면 우리 경로(close)로 먼저 닫는다. ReaderPanel.restore가 대신 닫으면
	 * suppress 플래그를 거치지 않아 onUserClose가 발화하고, 복원 도중에 번역이 꺼져버린다.
	 */
	public adopt(panel: vscode.WebviewPanel): void {
		this.close();
		this.panel = ReaderPanel.restore(panel, this.extensionUri, this.buildCallbacks());
	}

	/** 패널이 다른 탭 뒤에 있으면 앞으로 가져온다. enable처럼 사용자가 명시적으로 요청한 경우에만 */
	public reveal(): void {
		this.panel?.reveal();
	}

	/** 우리 쪽 사유로 닫는다 — onUserClose는 발화하지 않는다 */
	public close(): void {
		if (this.panel == null) {
			return;
		}
		this.suppressNextDispose = true;
		this.panel.dispose();
		this.panel = undefined;
		this.documentUri = undefined;
	}

	public dispose(): void {
		this.close();
	}

	private ensure(): ReaderPanel {
		if (this.panel != null) {
			return this.panel;
		}
		this.panel = ReaderPanel.showOrCreate(this.extensionUri, this.buildCallbacks());
		return this.panel;
	}

	private buildCallbacks(): ReaderPanelCallbacks {
		return {
			onDispose: () => {
				this.panel = undefined;
				if (this.suppressNextDispose == true) {
					this.suppressNextDispose = false;
					return;
				}
				this.onUserClose();
			},
			onJumpTo: (line, focusEditor) => {
				if (this.documentUri == null) {
					return;
				}
				this.onJumpTo(this.documentUri, line, focusEditor);
			},
			onAction: (action) => {
				this.onAction(action);
			},
			onOpenLink: (href) => {
				this.onOpenLink(href);
			},
			onCopy: (text) => {
				this.onCopy(text);
			},
		};
	}
}
