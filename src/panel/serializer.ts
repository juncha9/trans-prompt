import * as vscode from 'vscode';
import { PANEL_VIEW_TYPE } from './reader-panel';

/**
 * 창 재시작 후 VSCode가 되살린 패널을 확장에 다시 연결한다.
 *
 * package.json의 activationEvents에 `onWebviewPanel:transPromptPanel`이 함께 있어야 한다 —
 * 없으면 복원 시점에 확장이 켜지지 않아 빈 패널만 남는다.
 */
export function registerPanelSerializer(adopt: (panel: vscode.WebviewPanel) => void): vscode.Disposable {
	return vscode.window.registerWebviewPanelSerializer(PANEL_VIEW_TYPE, {
		async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
			adopt(panel);
		},
	});
}
