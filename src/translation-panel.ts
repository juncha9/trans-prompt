import * as vscode from 'vscode';

/**
 * 'panel' 모드의 사이드 Webview를 관리한다.
 *
 * - 한 번에 하나의 패널만 존재 (currentPanel 싱글톤)
 * - update(entries): 라인 인덱스 → 번역문 매핑을 받아 webview HTML을 갱신
 * - 사용자가 패널을 닫으면 currentPanel = undefined로 초기화
 */
export type PanelEntry = { line: number; translated: string };

export class TranslationPanel {
	public static currentPanel: TranslationPanel | undefined;
	private static readonly viewType = 'transPromptPanel';

	private readonly panel: vscode.WebviewPanel;
	private disposables: vscode.Disposable[] = [];
	private lastEntries: PanelEntry[] = [];
	private onDisposeCb?: () => void;
	private onJumpToCb?: (line: number) => void;

	private constructor(panel: vscode.WebviewPanel) {
		this.panel = panel;
		this.panel.webview.html = this.buildHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage((msg) => {
			if (msg?.type === 'jumpTo' && typeof msg.line === 'number') {
				this.onJumpToCb?.(msg.line);
			} else if (msg?.type === 'runCommand' && typeof msg.commandId === 'string') {
				vscode.commands.executeCommand(msg.commandId);
			}
		}, null, this.disposables);
	}

	public static showOrCreate(opts?: {
		onDispose?: () => void;
		onJumpTo?: (line: number) => void;
	}): TranslationPanel {
		if (TranslationPanel.currentPanel != null) {
			TranslationPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside, true);
			return TranslationPanel.currentPanel;
		}
		const panel = vscode.window.createWebviewPanel(
			TranslationPanel.viewType,
			'Trans Prompt',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		TranslationPanel.currentPanel = new TranslationPanel(panel);
		TranslationPanel.currentPanel.onDisposeCb = opts?.onDispose;
		TranslationPanel.currentPanel.onJumpToCb = opts?.onJumpTo;
		return TranslationPanel.currentPanel;
	}

	public update(entries: PanelEntry[]): void {
		this.lastEntries = entries;
		this.panel.webview.postMessage({ type: 'update', entries });
	}

	public setActiveLine(line: number): void {
		this.panel.webview.postMessage({ type: 'activeLine', line });
	}

	public showMessage(text: string, action?: { label: string; commandId: string }): void {
		this.lastEntries = [];
		this.panel.webview.postMessage({ type: 'message', text, action });
	}

	public dispose(): void {
		TranslationPanel.currentPanel = undefined;
		this.panel.dispose();
		while (this.disposables.length > 0) {
			const d = this.disposables.pop();
			d?.dispose();
		}
		this.onDisposeCb?.();
		this.onDisposeCb = undefined;
		this.onJumpToCb = undefined;
	}

	/**
	 * webview HTML — 라인 번호 + 번역문 한 줄씩 렌더.
	 */
	private buildHtml(): string {
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
	html, body {
		margin: 0;
		padding: 0;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--vscode-editor-font-size);
		color: var(--vscode-editor-foreground);
		background: var(--vscode-editor-background);
	}
	.rows {
		padding: 12px 16px 32px;
	}
	.row {
		display: flex;
		gap: 12px;
		line-height: 1.7em;
		padding: 4px 8px;
		border-left: 3px solid transparent;
		border-radius: 2px;
		transition: background-color 0.08s linear;
		cursor: pointer;
	}
	.row:hover {
		background: var(--vscode-list-hoverBackground);
	}
	.row.gap {
		margin-top: 0.7em;
	}
	.row.active {
		background: var(--vscode-list-activeSelectionBackground, var(--vscode-editor-selectionBackground));
		color: var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground));
		border-left-color: var(--vscode-focusBorder, #007acc);
	}
	.row.active .line-no {
		color: var(--vscode-list-activeSelectionForeground, var(--vscode-editorLineNumber-activeForeground));
		opacity: 1;
	}
	.line-no {
		color: var(--vscode-editorLineNumber-foreground);
		min-width: 3em;
		text-align: right;
		user-select: none;
		flex-shrink: 0;
		opacity: 0.6;
	}
	.translated {
		white-space: pre-wrap;
		word-break: break-word;
	}
	.empty {
		color: var(--vscode-descriptionForeground);
		font-style: italic;
		white-space: pre-line;
		line-height: 1.6em;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 18px;
		min-height: 80vh;
		padding: 24px;
	}
	.empty .action-btn {
		font-family: inherit;
		font-size: var(--vscode-font-size);
		font-style: normal;
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: 1px solid var(--vscode-button-border, transparent);
		padding: 6px 16px;
		border-radius: 2px;
		cursor: pointer;
	}
	.empty .action-btn:hover {
		background: var(--vscode-button-hoverBackground);
	}
	.empty .action-btn:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}
</style>
</head>
<body>
<div id="root"><div class="empty">Waiting for translations…</div></div>
<script>
	const vscodeApi = acquireVsCodeApi();
	const root = document.getElementById('root');
	let rowsByLine = new Map();
	let sortedLines = [];
	let activeLine = -1;

	function applyActive() {
		// 활성 라인에 매칭되는 row를 찾는다 — 정확히 일치하는 entry가 없으면 ≤activeLine 중 가장 큰 line
		let targetLine = -1;
		if (rowsByLine.has(activeLine)) {
			targetLine = activeLine;
		} else {
			for (const ln of sortedLines) {
				if (ln <= activeLine) { targetLine = ln; } else { break; }
			}
		}
		for (const [ln, row] of rowsByLine) {
			if (ln === targetLine) { row.classList.add('active'); }
			else { row.classList.remove('active'); }
		}
		const target = rowsByLine.get(targetLine);
		if (target) {
			target.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	}

	function render(entries) {
		rowsByLine = new Map();
		sortedLines = [];
		if (!entries || entries.length === 0) {
			root.innerHTML = '<div class="empty">No translatable content.</div>';
			return;
		}
		const container = document.createElement('div');
		container.className = 'rows';
		let prevLine = -2;
		for (const e of entries) {
			const row = document.createElement('div');
			row.className = 'row';
			// 단락 사이 (라인 번호 점프) 시각적 갭 추가
			if (prevLine >= 0 && e.line - prevLine > 1) {
				row.classList.add('gap');
			}
			prevLine = e.line;

			const lineNo = document.createElement('div');
			lineNo.className = 'line-no';
			lineNo.textContent = String(e.line + 1);

			const translated = document.createElement('div');
			translated.className = 'translated';
			translated.textContent = e.translated;

			row.appendChild(lineNo);
			row.appendChild(translated);
			row.addEventListener('click', () => {
				vscodeApi.postMessage({ type: 'jumpTo', line: e.line });
			});
			container.appendChild(row);
			rowsByLine.set(e.line, row);
			sortedLines.push(e.line);
		}
		sortedLines.sort((a, b) => a - b);
		root.innerHTML = '';
		root.appendChild(container);
		applyActive();
	}

	function showMessage(text, action) {
		rowsByLine = new Map();
		sortedLines = [];
		const div = document.createElement('div');
		div.className = 'empty';
		const textEl = document.createElement('div');
		textEl.textContent = text;
		div.appendChild(textEl);
		if (action && action.label && action.commandId) {
			const btn = document.createElement('button');
			btn.className = 'action-btn';
			btn.textContent = action.label;
			btn.addEventListener('click', () => {
				vscodeApi.postMessage({ type: 'runCommand', commandId: action.commandId });
			});
			div.appendChild(btn);
		}
		root.innerHTML = '';
		root.appendChild(div);
	}

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (msg.type === 'update') { render(msg.entries); }
		else if (msg.type === 'activeLine') {
			activeLine = msg.line;
			applyActive();
		}
		else if (msg.type === 'message') { showMessage(msg.text, msg.action); }
	});
</script>
</body>
</html>`;
	}
}
