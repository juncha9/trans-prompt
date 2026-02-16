import * as vscode from 'vscode';
import { TranslationCache } from './translation-cache';
import { GcpTranslator } from './gcp-translator';
import { getDisplayWidth, parseParagraphs } from './_utils';

export function activate(context: vscode.ExtensionContext) {

	const cache = new TranslationCache(context.globalState);

	// Load configuration
	function getConfig() {
		const config = vscode.workspace.getConfiguration('trans-prompt');
		return {
			target_language: config.get<string>('target_language', 'ko'),
			google_api_key: config.get<string>('google_api_key', ''),
			display_gap: config.get<number>('display_gap', 8)
		};
	}

	// Clear cache command
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.clearCache', async () => {
			await cache.clear();
			vscode.window.showInformationMessage(`Trans Prompt: Translation cache cleared. (${cache.size} entries)`);
			currentDecorations = [];
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
			if (picked == null || picked.code === current) { return; }
			await vscode.workspace.getConfiguration('trans-prompt').update('target_language', picked.code, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Trans Prompt: Target language set to ${picked.label}.`);
		})
	);

	// Clear translation cache for the current line
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.reloadLine', async () => {
			if (activeEditor == null) { return; }
			const lineText = activeEditor.document.lineAt(activeEditor.selection.active.line).text.trim();
			if (lineText == null) { return; }
			const { target_language: targetLang } = getConfig();
			await cache.delete(lineText, targetLang);
			translateDocument();
		})
	);

	// Set display gap
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.setGap', async () => {
			const current = getConfig().display_gap;
			const input = await vscode.window.showInputBox({
				prompt: 'Enter display gap (0-40)',
				value: String(current),
				validateInput: (value) => {
					const num = Number(value);
					if (isNaN(num) || num < 0 || num > 40 || Math.floor(num) !== num) {
						return 'Please enter an integer between 0 and 40.';
					}
					return null;
				}
			});
			if (input == null) { return; }
			const gap = Number(input);
			if (gap === current) { return; }
			await vscode.workspace.getConfiguration('trans-prompt').update('display_gap', gap, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`Trans Prompt: Display gap set to ${gap}.`);
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
            color: new vscode.ThemeColor('descriptionForeground'),
            fontStyle: 'italic',
        },
    });

    let activeEditor = vscode.window.activeTextEditor;
	let activeLine = activeEditor?.selection.active.line ?? -1;
	let currentDecorations: vscode.DecorationOptions[] = [];
	let dirty = false;

	function applyDecorations() {
		if (activeEditor == null) { return; }
		const filtered = currentDecorations.filter(d => d.range.start.line !== activeLine);
		activeEditor.setDecorations(translationDecorationType, filtered);
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
		if (activeEditor == null || activeEditor.document.fileName.endsWith('.md') == false) {
			return;
		}

		const editor = activeEditor;
		const _config = getConfig();
		const targetLanguage = _config.target_language;
		const apiKey = _config.google_api_key;
		const gap = _config.display_gap;

		if (apiKey == null) {
			vscode.window.showWarningMessage('Trans Prompt: Google API key is not configured.');
			return;
		}

		const translator = new GcpTranslator(apiKey);
		const lines = editor.document.getText().split('\n');
		const paragraphs = parseParagraphs(lines);
		// Show loading placeholders for uncached lines
		const previewDecorations: vscode.DecorationOptions[] = [];
		for (const para of paragraphs) {
			const maxLen = Math.max(...para.map(i => getDisplayWidth(lines[i])));
			for (const i of para) {
				const lineText = lines[i].trim();
				if (lineText == null) { continue; }
				const cached = cache.get(lineText, targetLanguage);
				if (cached) {
					previewDecorations.push(buildDecoration(lines[i], i, maxLen, gap, cached));
				} else {
					previewDecorations.push(buildDecoration(lines[i], i, maxLen, gap, 'translating...', 'rgba(128,128,128,0.5)'));
				}
			}
		}
		currentDecorations = previewDecorations;
		applyDecorations();

		// Translate and build final decorations
		const decorations: vscode.DecorationOptions[] = [];
		for (const para of paragraphs) {
			const maxLen = Math.max(...para.map(i => getDisplayWidth(lines[i])));
			for (const i of para) {
				const lineText = lines[i].trim();
				if (lineText == null || lineText == "") { continue; }

				let translatedText = cache.get(lineText, targetLanguage);
				if (translatedText != null) {
					console.log(`[trans-prompt] cache hit: "${lineText.substring(0, 30)}..."`);
				} else {
					try {
						console.log(`[trans-prompt] translating: "${lineText.substring(0, 30)}..."`);
						translatedText = await translator.translate(lineText, targetLanguage);
						await cache.set(lineText, targetLanguage, translatedText);
					} catch (error) {
						console.error('[trans-prompt] translation error:', error);
						translatedText = `(translation error)`;
					}
				}
				decorations.push(buildDecoration(lines[i], i, maxLen, gap, translatedText));
			}
		}

		if (editor === activeEditor) {
			// Update decorations only if the active editor hasn't changed during async calls
			currentDecorations = decorations;
			applyDecorations();
		}
	}

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
		activeLine = editor?.selection.active.line ?? -1;
		currentDecorations = [];
		if (editor != null) {
			editor.setDecorations(translationDecorationType, []);
		}
    }, null, context.subscriptions);

	vscode.window.onDidChangeTextEditorSelection(event => {
		if (event.textEditor !== activeEditor) { return; }
		const newLine = event.selections[0].active.line;
		if (newLine !== activeLine) {
			activeLine = newLine;
			if (dirty) {
				dirty = false;
				translateDocument();
			} else {
				applyDecorations();
			}
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor == null || event.document !== activeEditor.document) { return; }
		if (event.document.fileName.endsWith('.md') == false) { return; }
		dirty = true;
	}, null, context.subscriptions);
}

// This method is called when your extension is deactivated
export function deactivate() {}
