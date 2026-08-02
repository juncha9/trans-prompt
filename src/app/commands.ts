import * as vscode from 'vscode';
import type { TranslationCache } from '../cache/translation-cache';
import type { ConfigService } from './config-service';
import type { TransPromptController } from './controller';

const LANGUAGES = [
	{ code: 'ko', label: 'Korean (한국어)' },
	{ code: 'ja', label: 'Japanese (日本語)' },
	{ code: 'en', label: 'English' },
	{ code: 'zh-CN', label: 'Chinese Simplified (简体中文)' },
	{ code: 'zh-TW', label: 'Chinese Traditional (繁體中文)' },
	{ code: 'fr', label: 'French (Français)' },
	{ code: 'de', label: 'German (Deutsch)' },
	{ code: 'es', label: 'Spanish (Español)' },
	{ code: 'ru', label: 'Russian (Русский)' },
];

/**
 * 모든 커맨드를 등록하고 Disposable 배열을 돌려준다.
 * 설정 변경은 ConfigService.update만 호출한다 — 재번역은 onDidChangeConfiguration이 알아서 태운다.
 */
export function registerCommands(
	controller: TransPromptController,
	config: ConfigService,
	cache: TranslationCache
): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('trans-prompt.enable', () => {
			controller.enable();
		}),

		vscode.commands.registerCommand('trans-prompt.disable', () => {
			controller.disable();
		}),

		vscode.commands.registerCommand('trans-prompt.translate', () => {
			controller.translate();
		}),

		vscode.commands.registerCommand('trans-prompt.reloadLine', async () => {
			await controller.reloadAtCursor();
		}),

		vscode.commands.registerCommand('trans-prompt.clearCache', async () => {
			const clearedCount = cache.size;
			await cache.clear();
			controller.handleCacheCleared();
			void vscode.window.showInformationMessage(`Trans Prompt: Translation cache cleared. (${clearedCount} entries)`);
		}),

		vscode.commands.registerCommand('trans-prompt.setApiKey', async () => {
			const currentKey = config.current.google_api_key;
			const input = await vscode.window.showInputBox({
				prompt: 'Enter your Google Cloud Translation API Key',
				value: currentKey,
				ignoreFocusOut: true,
				password: true,
			});
			// Esc로 취소한 경우와 빈 문자열을 입력해 지우려는 경우는 다르다
			if (input == null) {
				return;
			}
			const apiKey = input.trim();
			if (apiKey === '') {
				await config.update('google_api_key', '');
				void vscode.window.showInformationMessage('Trans Prompt: Google API key has been removed.');
				return;
			}
			if (apiKey === currentKey) {
				void vscode.window.showInformationMessage('Trans Prompt: The entered API key is the same as the current one. No changes made.');
				return;
			}
			await config.update('google_api_key', apiKey);
			void vscode.window.showInformationMessage('Trans Prompt: Google API key has been updated.');
		}),

		vscode.commands.registerCommand('trans-prompt.setLanguage', async () => {
			const currentLanguage = config.current.target_language;
			const items = LANGUAGES.map((language) => {
				let description = '';
				if (language.code === currentLanguage) {
					description = '(current)';
				}
				return { label: language.label, description, code: language.code };
			});
			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select target language',
			});
			if (picked == null || picked.code === currentLanguage) {
				return;
			}
			await config.update('target_language', picked.code);
			void vscode.window.showInformationMessage(`Trans Prompt: Target language set to ${picked.label}.`);
		}),
	];
}
