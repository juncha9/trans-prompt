import * as vscode from 'vscode';
import { TranslationCache } from './translation-cache';
import { GcpTranslator } from './gcp-translator';
import { getDisplayWidth, parseParagraphs } from './_utils';

let activeCache: TranslationCache | undefined;

/**
 * Trans Prompt 확장의 진입점.
 * 모든 commands, decoration, listeners를 등록하고 내부 상태/헬퍼를 정의한다.
 *
 * Flow (등록 순서):
 *  1) 캐시 초기화 + deactivate flush hook
 *  2) 설정 로더 정의 (target_language / google_api_key / display_gap)
 *  3) 명령 등록
 *      - clearCache, setApiKey, setLanguage, reloadLine, setGap
 *      - enable / disable: 문서 URI별 enabledDocs 토글 + 컨텍스트 키 갱신
 *      - translate: enabled 일 때만 동작
 *  4) 데코레이션 타입 정의 (원문 옆 회색 italic 오버레이)
 *  5) 상태 변수 선언 (activeEditor, activeLine, currentDecorations, dirty, enabled, translating, enabledDocs)
 *  6) 내부 헬퍼 정의 (getDocKey / scheduleTranslate / cancelScheduledTranslate / buildDecoration / translateDocument)
 *  7) 이벤트 리스너 바인딩
 *      - 활성 에디터 변경 → enabledDocs로 enabled 상태 복원
 *      - 문서 close → enabledDocs cleanup
 *      - selection 변경 → dirty 시 즉시 재번역, 아니면 활성 라인 데코 갱신
 *      - 텍스트 변경 → dirty 마킹 + 600ms 디바운스 재번역
 */
export function activate(context: vscode.ExtensionContext) {

	// (1) 캐시 초기화 + deactivate flush hook
	const cache = new TranslationCache(context.globalState);
	activeCache = cache;
	context.subscriptions.push({ dispose: () => { void cache.flush(); } });

	// (2) 설정 로더
	function getConfig() {
		const config = vscode.workspace.getConfiguration('trans-prompt');
		return {
			target_language: config.get<string>('target_language', 'ko'),
			google_api_key: config.get<string>('google_api_key', ''),
			display_gap: config.get<number>('display_gap', 8)
		};
	}

	// (3) 명령 등록 ─────────────────────────────────────────────

	// (3.1) clearCache: 번역 캐시 비우기 + 현재 데코레이션 제거
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.clearCache', async () => {
			await cache.clear();
			vscode.window.showInformationMessage(`Trans Prompt: Translation cache cleared. (${cache.size} entries)`);
			currentDecorations = [];
			activeEditor?.setDecorations(translationDecorationType, []);
		})
	);

    // (3.2) setApiKey: 입력 다이얼로그로 키를 받아 globalState에 저장 (빈 입력은 제거로 처리)
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

	// (3.3) setLanguage: QuickPick으로 타겟 언어 선택
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

	// (3.4) reloadLine: 현재 라인 캐시 무효화 + 재번역 후 해당 라인 데코레이션만 교체
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.reloadLine', async () => {
			if (activeEditor == null || enabled == false) { return; }
			const lineIndex = activeEditor.selection.active.line;
			const line = activeEditor.document.lineAt(lineIndex).text;
			const lineText = line.trim();
			if (lineText == null || lineText == "") { return; }

			const { target_language: targetLang, google_api_key: apiKey, display_gap: gap } = getConfig();
			if (!apiKey || apiKey.trim() === '') {
				vscode.window.showWarningMessage('Trans Prompt: Google API key is not configured.');
				return;
			}

			await cache.delete(lineText, targetLang);

			const translator = new GcpTranslator(apiKey);
			let translatedText: string;
			try {
				translatedText = await translator.translate(lineText, targetLang);
				await cache.set(lineText, targetLang, translatedText);
			} catch (error) {
				console.error('[trans-prompt] translation error:', error);
				translatedText = '(translation error)';
			}

			// Find the paragraph containing this line to calculate maxLen
			const lines = activeEditor.document.getText().split('\n');
			const paragraphs = parseParagraphs(lines);
			const para = paragraphs.find(p => p.includes(lineIndex));
			const maxLen = para != null
				? Math.max(...para.map(i => getDisplayWidth(lines[i])))
				: getDisplayWidth(line);

			// Replace the decoration for this line
			currentDecorations = currentDecorations.filter(d => d.range.start.line !== lineIndex);
			currentDecorations.push(buildDecoration(line, lineIndex, maxLen, gap, translatedText));
			const filtered = currentDecorations.filter(d => d.range.start.line !== activeLine);
			activeEditor.setDecorations(translationDecorationType, filtered);
		})
	);

	// (3.5) setGap: 원문/번역 사이 간격(0~40)을 입력받아 즉시 재번역으로 반영
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

	// (3.6) enable: 현재 문서를 enabledDocs에 추가, 컨텍스트 키 켜고 즉시 번역
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.enable', () => {
			const key = getDocKey(activeEditor);
			if (key != null) { enabledDocs.add(key); }
			enabled = true;
			vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', true);
			translateDocument();
		})
	);

	// (3.7) disable: enabledDocs에서 제거, 디바운스 취소, 데코레이션 제거
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.disable', () => {
			const key = getDocKey(activeEditor);
			if (key != null) { enabledDocs.delete(key); }
			enabled = false;
			cancelScheduledTranslate();
			vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', false);
			currentDecorations = [];
			activeEditor?.setDecorations(translationDecorationType, []);
		})
	);

	// (3.8) translate: enabled 일 때만 현재 문서 재번역 트리거
	context.subscriptions.push(
		vscode.commands.registerCommand('trans-prompt.translate', () => {
			if (enabled == false) { return; }
			translateDocument();
		})
	);

	// (4) 데코레이션 타입 정의 — 원문 옆 'after' 위치에 회색 italic 텍스트
    const translationDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            color: new vscode.ThemeColor('descriptionForeground'),
            fontStyle: 'italic',
        },
    });
    context.subscriptions.push(translationDecorationType);

    // (5) 상태 변수 — closure로 commands/listeners가 모두 공유
	//     activeEditor: 현재 추적 중인 에디터 (탭 전환 시 갱신)
	//     activeLine: 커서가 있는 라인 (해당 라인은 데코레이션에서 제외하여 입력 방해 방지)
	//     currentDecorations: 마지막으로 그린 데코레이션 옵션 목록
	//     dirty: 텍스트가 변경됐지만 아직 재번역되지 않음
	//     enabled: 현재 활성 에디터에서 번역 표시가 켜져 있는지
	//     translating: translateDocument 동시 실행 방지 플래그
	//     enabledDocs: 문서 URI 단위 enabled 상태 — 탭을 다녀와도 복원되도록
    let activeEditor = vscode.window.activeTextEditor;
	let activeLine = activeEditor?.selection.active.line ?? -1;
	let currentDecorations: vscode.DecorationOptions[] = [];
	let dirty = false;
	let enabled = false;
	let translating = false;
	const enabledDocs = new Set<string>();

	// (6) 내부 헬퍼 ─────────────────────────────────────────────

	// (6.1) getDocKey: enabledDocs 키로 사용할 URI 문자열
	function getDocKey(editor: vscode.TextEditor | undefined): string | undefined {
		return editor?.document.uri.toString();
	}

	// (6.2) scheduleTranslate / cancelScheduledTranslate: 텍스트 변경 시 600ms 디바운스
	let translateTimer: NodeJS.Timeout | undefined;
	const TRANSLATE_DEBOUNCE_MS = 600;

	function scheduleTranslate(delayMs: number = TRANSLATE_DEBOUNCE_MS) {
		if (translateTimer != null) { clearTimeout(translateTimer); }
		translateTimer = setTimeout(() => {
			translateTimer = undefined;
			if (enabled === true) {
				dirty = false;
				translateDocument();
			}
		}, delayMs);
	}

	function cancelScheduledTranslate() {
		if (translateTimer != null) {
			clearTimeout(translateTimer);
			translateTimer = undefined;
		}
	}

	context.subscriptions.push({ dispose: cancelScheduledTranslate });


	// (6.3) buildDecoration: 한 라인의 데코레이션 옵션 생성
	//       padding = (단락 내 최대 폭 - 현재 라인 폭) + gap → 같은 컬럼에서 번역문이 시작
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

	// (6.4) translateDocument: 메인 번역 루틴 (자세한 흐름은 아래 JSDoc 참조)
	/**
	 * 현재 활성 에디터의 문서를 번역하여 데코레이션(원문 옆 회색 번역)을 그린다.
	 *
	 * 흐름:
	 *  1) 가드: .md 파일이 아니거나 이미 번역 중이면 즉시 종료
	 *  2) 설정 로드 및 API 키 검증
	 *  3) 문서를 단락(paragraph) 단위로 파싱 — 코드블록은 주석 라인만 포함
	 *  4) [1차 패스] 즉시 미리보기 표시
	 *      - 캐시 히트 라인: 번역 결과를 바로 표시
	 *      - 캐시 미스 라인: 회색 'translating...' 플레이스홀더로 표시
	 *  5) [2차 패스] 캐시 미스 라인을 dedupe + 100개 청크 batch로 API 호출
	 *  6) 호출 결과를 캐시에 저장하고, 모든 라인을 최종 데코레이션으로 교체
	 *  7) 최종 가드: 호출 도중 사용자가 다른 에디터로 이동했거나
	 *     비활성화했다면 결과를 적용하지 않음
	 *
	 * 활성 라인(커서가 있는 라인)은 입력을 방해하지 않도록 데코레이션에서 제외된다.
	 */
	async function translateDocument() {
		// (1) .md 문서가 아니거나 동시 실행이면 종료
		if (activeEditor == null || activeEditor.document.fileName.endsWith('.md') == false) {
			return;
		}
		if (translating == true) {
			return;
		}
		translating = true;
		try {
			// (2) 설정 로드 및 API 키 검증
			//     editor 변수에 스냅샷을 잡아둔다 — async 호출 도중 activeEditor가 바뀔 수 있기 때문
			const editor = activeEditor;
			const _config = getConfig();
			const targetLanguage = _config.target_language;
			const apiKey = _config.google_api_key;
			const gap = _config.display_gap;

			if (!apiKey || apiKey.trim() === '') {
				vscode.window.showWarningMessage('Trans Prompt: Google API key is not configured.');
				return;
			}

			// (3) 단락 파싱 — paragraphs는 [[lineIdx, ...], [lineIdx, ...], ...] 형태
			const translator = new GcpTranslator(apiKey);
			const lines = editor.document.getText().split('\n');
			const paragraphs = parseParagraphs(lines);

			// (4) 1차 패스: 즉시 미리보기 데코레이션을 그린다
			//     - 같은 단락 내 라인들의 표시 폭(maxLen)을 맞춰 번역문이 같은 컬럼에서 시작하게 함
			//     - 캐시 히트는 실제 번역, 캐시 미스는 'translating...' 플레이스홀더
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
			// 활성 라인은 입력 방해 방지를 위해 데코레이션에서 제외
			const previewFiltered = currentDecorations.filter(d => d.range.start.line !== activeLine);
			editor.setDecorations(translationDecorationType, previewFiltered);

			// (5) 2차 패스 준비: 캐시 히트 라인은 최종 데코레이션에 바로 push,
			//     캐시 미스 라인은 batch 호출 대상으로 pending 큐에 모은다
			const decorations: vscode.DecorationOptions[] = [];
			type Pending = { rawLine: string; lineIndex: number; lineText: string; maxLen: number };
			const pending: Pending[] = [];

			for (const para of paragraphs) {
				const maxLen = Math.max(...para.map(i => getDisplayWidth(lines[i])));
				for (const i of para) {
					const lineText = lines[i].trim();
					if (lineText === '') { continue; }

					const cached = cache.get(lineText, targetLanguage);
					if (cached != null) {
						decorations.push(buildDecoration(lines[i], i, maxLen, gap, cached));
					} else {
						pending.push({ rawLine: lines[i], lineIndex: i, lineText, maxLen });
					}
				}
			}

			// (6) 캐시 미스 라인을 batch로 번역
			//     - dedupe: 동일한 영어 문장이 여러 라인에 있으면 한 번만 호출
			//     - chunk: Google v2 REST 한 요청당 텍스트 100개로 제한 (q 배열 크기)
			//     - translationMap: 원문 → 번역문 매핑. 청크 실패 시 해당 청크의 모든 항목은 에러 문구로 채움
			if (pending.length > 0) {
				const uniqueTexts = Array.from(new Set(pending.map(p => p.lineText)));
				const translationMap = new Map<string, string>();
				const BATCH_SIZE = 100;

				for (let i = 0; i < uniqueTexts.length; i += BATCH_SIZE) {
					const chunk = uniqueTexts.slice(i, i + BATCH_SIZE);
					try {
						const results = await translator.translateBatch(chunk, targetLanguage);
						for (let j = 0; j < chunk.length; j++) {
							translationMap.set(chunk[j], results[j]);
							await cache.set(chunk[j], targetLanguage, results[j]);
						}
					} catch (error) {
						console.error('[trans-prompt] batch translation error:', error);
						for (const t of chunk) {
							translationMap.set(t, '(translation error)');
						}
					}
				}

				// pending 라인들을 매핑 결과로 데코레이션화 (중복 텍스트도 같은 결과를 공유)
				for (const p of pending) {
					const translated = translationMap.get(p.lineText) ?? '(translation error)';
					decorations.push(buildDecoration(p.rawLine, p.lineIndex, p.maxLen, gap, translated));
				}
			}

			// (7) 최종 가드: API 호출 중 사용자가 탭을 이동했거나 비활성화했다면
			//     결과를 적용하지 않는다 (스냅샷 editor와 현재 activeEditor 비교)
			if (editor === activeEditor && enabled == true) {
				currentDecorations = decorations;
				const finalFiltered = currentDecorations.filter(d => d.range.start.line !== activeLine);
				editor.setDecorations(translationDecorationType, finalFiltered);
			}
		} finally {
			translating = false;
		}
	}

	// (7) 이벤트 리스너 ─────────────────────────────────────────

	// (7.1) 활성 에디터 변경: 새 문서로 상태를 갈아끼고 enabledDocs로 enabled 복원
	vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
		activeLine = editor?.selection.active.line ?? -1;
		currentDecorations = [];
		cancelScheduledTranslate();
		const key = getDocKey(editor);
		const wasEnabled = key != null && enabledDocs.has(key);
		enabled = wasEnabled;
		vscode.commands.executeCommand('setContext', 'trans-prompt.enabled', wasEnabled);
		if (editor != null) {
			editor.setDecorations(translationDecorationType, []);
			if (wasEnabled) {
				translateDocument();
			}
		}
    }, null, context.subscriptions);

	// (7.2) 문서 닫힘: enabledDocs cleanup (메모리 누수 방지)
	vscode.workspace.onDidCloseTextDocument(doc => {
		enabledDocs.delete(doc.uri.toString());
	}, null, context.subscriptions);

	// (7.3) 선택 영역 변경: 라인이 바뀐 경우만 처리
	//       - dirty 였다면 즉시 재번역 (디바운스 취소)
	//       - 아니면 새 활성 라인의 데코레이션만 숨기는 갱신
	vscode.window.onDidChangeTextEditorSelection(event => {
		if (event.textEditor !== activeEditor) { return; }
		const newLine = event.selections[0].active.line;
		if (newLine !== activeLine) {
			activeLine = newLine;
			if (dirty === true && enabled === true) {
				cancelScheduledTranslate();
				dirty = false;
				translateDocument();
			} else if (activeEditor != null) {
				const filtered = currentDecorations.filter(d => d.range.start.line !== activeLine);
				activeEditor.setDecorations(translationDecorationType, filtered);
			}
		}
	}, null, context.subscriptions);

	// (7.4) 텍스트 변경: dirty 마킹 + enabled 일 때 디바운스 재번역 예약
	vscode.workspace.onDidChangeTextDocument(event => {
		if (activeEditor == null || event.document !== activeEditor.document) { return; }
		if (event.document.fileName.endsWith('.md') == false) { return; }
		dirty = true;
		if (enabled === true) {
			scheduleTranslate();
		}
	}, null, context.subscriptions);
}

// This method is called when your extension is deactivated
export async function deactivate() {
	if (activeCache != null) {
		await activeCache.flush();
		activeCache = undefined;
	}
}
