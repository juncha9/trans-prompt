import * as vscode from 'vscode';
import { TranslationCache } from './translation-cache';
import { GcpTranslator } from './gcp-translator';
import { getDisplayWidth } from './_utils';

export function activate(context: vscode.ExtensionContext) {

	const cache = new TranslationCache(context.globalState);

	// Load configuration
	function getConfig() {
		const config = vscode.workspace.getConfiguration('trans-prompt');
		return {
			target_language: config.get<string>('target_language', 'ko'),
			google_api_key: config.get<string>('google_api_key', '')
		};
	}

	// Clear cache command
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.clearCache', async () => {
			await cache.clear();
			vscode.window.showInformationMessage(`Trans Prompt: Translation cache cleared. (${cache.size} entries)`);
			activeEditor?.setDecorations(translationDecorationType, []);
		})
	);

    context.subscriptions.push(
        vscode.commands.registerCommand('trans-prompt.setApiKey', async () => {
            const config = getConfig();
            const currentKey = config.google_api_key ?? '';
            const apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Google Cloud Translation API Key',
                value: currentKey,
                ignoreFocusOut: true,
                password: true
            });
            if (apiKey == null || apiKey.trim() === '') {
                await vscode.workspace.getConfiguration('trans-prompt').update('google_api_key', '', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage("Trans Prompt: Google API key has been removed.");
                return;
            }

            if (apiKey != currentKey) {
                await vscode.workspace.getConfiguration('trans-prompt').update('google_api_key', apiKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Trans Prompt: Google API key has been updated.');
            }
            else {
                vscode.window.showInformationMessage('Trans Prompt: The entered API key is the same as the current one. No changes made.');
            }

        })
    );

	// Set target language
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

	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.setLanguage', async () => {
			const current = getConfig().target_language;
			const items = LANGUAGES.map(lang => ({
				label: lang.label,
				description: lang.code === current ? '(current)' : '',
				code: lang.code,
			}));
			const picked = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select target language',
			});
			if (!picked || picked.code === current) { return; }
			await vscode.workspace.getConfiguration('trans-prompt').update('target_language', picked.code, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Trans Prompt: Target language set to ${picked.label}.`);
		})
	);

	// Clear translation cache for the current line
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.reloadLine', async () => {
			if (!activeEditor) { return; }
			const lineText = activeEditor.document.lineAt(activeEditor.selection.active.line).text.trim();
			if (!lineText) { return; }
			const { target_language: targetLang } = getConfig();
			await cache.delete(lineText, targetLang);
			translateDocument();
		})
	);

	// Translate current document
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.translate', () => {
			translateDocument();
		})
	);

	// Define decoration style
    const translationDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 1em',
            contentText: '',
            color: new vscode.ThemeColor('descriptionForeground'),
            fontStyle: 'italic',
        },
    });

    let activeEditor = vscode.window.activeTextEditor;

	function parseParagraphs(lines: string[]): number[][] {
        // Group lines into paragraphs (blocks of non-empty lines)
		const paragraphs: number[][] = [];
		let current: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim().length > 0) {
				current.push(i);
			} else if (current.length > 0) {
				paragraphs.push(current);
				current = [];
			}
		}
		if (current.length > 0) {
			paragraphs.push(current);
		}
		return paragraphs;
	}

	function buildDecoration(line: string, lineIndex: number, maxLen: number, gap: number, text: string, color?: string): vscode.DecorationOptions {
		const padding = maxLen - getDisplayWidth(line) + gap;
		return {
			range: new vscode.Range(lineIndex, 0, lineIndex, line.length),
			renderOptions: {
				after: {
					contentText: text,
					margin: `0 0 0 ${padding}ch`,
					...(color ? { color } : {}),
				}
			}
		};
	}

	// Translate document: show cached + call API for uncached lines
	async function translateDocument() {
		if (!activeEditor || !activeEditor.document.fileName.endsWith('.md')) {
			return;
		}

		const editor = activeEditor;
		const { target_language: targetLang, google_api_key: apiKey } = getConfig();

		if (!apiKey) {
			vscode.window.showWarningMessage('Trans Prompt: Google API key is not configured.');
			return;
		}

		const translator = new GcpTranslator(apiKey);
		const lines = editor.document.getText().split('\n');
		const paragraphs = parseParagraphs(lines);
		const gap = 4;

		// Show loading placeholders for uncached lines
		const previewDecorations: vscode.DecorationOptions[] = [];
		for (const para of paragraphs) {
			const maxLen = Math.max(...para.map(i => getDisplayWidth(lines[i])));
			for (const i of para) {
				const lineText = lines[i].trim();
				if (!lineText) { continue; }
				const cached = cache.get(lineText, targetLang);
				if (cached) {
					previewDecorations.push(buildDecoration(lines[i], i, maxLen, gap, cached));
				} else {
					previewDecorations.push(buildDecoration(lines[i], i, maxLen, gap, 'translating...', 'rgba(128,128,128,0.5)'));
				}
			}
		}
		editor.setDecorations(translationDecorationType, previewDecorations);

		// Translate and build final decorations
		const decorations: vscode.DecorationOptions[] = [];
		for (const para of paragraphs) {
			const maxLen = Math.max(...para.map(i => getDisplayWidth(lines[i])));
			for (const i of para) {
				const lineText = lines[i].trim();
				if (!lineText) { continue; }

				let translatedText = cache.get(lineText, targetLang);
				if (!translatedText) {
					try {
						translatedText = await translator.translate(lineText, targetLang);
						await cache.set(lineText, targetLang, translatedText);
					} catch (error) {
						console.error('Translation error:', error);
						translatedText = `(translation error)`;
					}
				}
				decorations.push(buildDecoration(lines[i], i, maxLen, gap, translatedText));
			}
		}

		if (editor === activeEditor) {
			editor.setDecorations(translationDecorationType, decorations);
		}
	}

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
    }, null, context.subscriptions);
}

// This method is called when your extension is deactivated
export function deactivate() {}
