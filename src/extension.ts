import * as vscode from 'vscode';
import { TranslationCache } from './translation-cache';
import { GcpTranslator } from './gcp-translator';

export function activate(context: vscode.ExtensionContext) {

	const cache = new TranslationCache(context.globalState);

	// 설정 가져오기
	function getConfig() {
		const config = vscode.workspace.getConfiguration('trans-prompt');
		return {
			targetLanguage: config.get<string>('targetLanguage', 'ko'),
			googleApiKey: config.get<string>('googleApiKey', '')
		};
	}

	// 캐시 클리어 커맨드
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.clearCache', async () => {
			await cache.clear();
			vscode.window.showInformationMessage(`Trans Prompt: 번역 캐시를 비웠습니다. (${cache.size}개 항목)`);
		})
	);

	// 데코레이션 스타일 정의
    const translationDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 1em',
            contentText: '', // 여기에 번역본이 들어갑니다.
            color: new vscode.ThemeColor('descriptionForeground'), // 부드러운 색상
            fontStyle: 'italic',
        },
    });

    let activeEditor = vscode.window.activeTextEditor;

    async function updateDecorations() {
        if (!activeEditor || activeEditor.document.languageId !== 'markdown') {
			return;
		}

        const config = getConfig();
        const targetLang = config.targetLanguage;
        const apiKey = config.googleApiKey;

        if (!apiKey) {
            // API 키가 없으면 경고 (TODO: 첫 실행 시에만 표시)
            console.warn('Trans Prompt: Google API key not configured');
            return;
        }

		const translator = new GcpTranslator(apiKey);

        const decorations: vscode.DecorationOptions[] = [];
        const text = activeEditor.document.getText();
        const lines = text.split('\n');

        // 빈 줄 기준으로 단락 분리
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

        const gap = 4;

        for (const para of paragraphs) {
            // 단락 내 최대 줄 길이
            const maxLen = Math.max(...para.map(i => lines[i].length));

            for (const i of para) {
                const lineText = lines[i].trim();
                if (!lineText) {
					continue;
				}

                // 캐시 확인 → 없으면 번역 API 호출 → 캐시 저장
                let translatedText = cache.get(lineText, targetLang);
                
				if (!translatedText) {
                    try {
						// GCP Translation API 호출
                        translatedText = await translator.translate(lineText, targetLang);
                        await cache.set(lineText, targetLang, translatedText);
                    } catch (error) {
                        console.error('Translation error:', error);
                        translatedText = `(번역 오류)`;
                    }
                }

                const padding = maxLen - lines[i].length + gap;

                const decoration = {
                    range: new vscode.Range(i, 0, i, lines[i].length),
                    renderOptions: {
                        after: {
                            contentText: `${translatedText}`,
                            margin: `0 0 0 ${padding}ch`,
                        }
                    }
                };
                decorations.push(decoration);
            }
        }

        activeEditor.setDecorations(translationDecorationType, decorations);
    }

    // 최초 활성화 시 현재 에디터에 decoration 적용
    if (activeEditor) {
        updateDecorations();
    }

    // 파일이 열리거나 편집될 때 업데이트
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        updateDecorations();
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            updateDecorations();
        }
    }, null, context.subscriptions);
}

// This method is called when your extension is deactivated
export function deactivate() {}
