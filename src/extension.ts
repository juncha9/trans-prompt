import * as vscode from 'vscode';
import { registerCommands } from './app/commands';
import { ConfigService } from './app/config-service';
import { TransPromptController } from './app/controller';
import { TranslationCache } from './cache/translation-cache';
import { registerPanelSerializer } from './panel/serializer';

// deactivate()에서 마지막 flush를 하기 위한 참조. activate 클로저 밖에 있어야 한다
let activeCache: TranslationCache | undefined;

/**
 * 컴포지션 루트. 각 역할 객체를 만들어 엮고 subscriptions에 등록하는 일만 한다.
 */
export function activate(context: vscode.ExtensionContext): void {
	const cache = new TranslationCache(context.globalState);
	activeCache = cache;

	const config = new ConfigService();
	const controller = new TransPromptController(context.extensionUri, cache, config);

	context.subscriptions.push(
		config,
		controller,
		registerPanelSerializer((panel) => {
			controller.adoptRestoredPanel(panel);
		}),
		...registerCommands(controller, config, cache),
		{ dispose: () => { void cache.flush(); } },
	);
}

export async function deactivate(): Promise<void> {
	if (activeCache == null) {
		return;
	}
	await activeCache.flush();
	activeCache = undefined;
}
