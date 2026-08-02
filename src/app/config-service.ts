import * as vscode from 'vscode';

export const CONFIG_SECTION = 'trans-prompt';

export interface TransPromptConfig {
	readonly target_language: string;
	readonly google_api_key: string;
}

function readConfig(): TransPromptConfig {
	const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return {
		target_language: configuration.get<string>('target_language', 'ko'),
		google_api_key: configuration.get<string>('google_api_key', ''),
	};
}

/**
 * 설정 스냅샷을 들고 있으면서 변경을 이벤트로 알린다.
 *
 * 1.5.1은 onDidChangeConfiguration을 구독하지 않아서, settings.json을 직접 편집하면
 * 커맨드를 다시 실행하기 전까지 반영되지 않았다. 여기서 구독을 한곳에 모은다.
 */
export class ConfigService implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<TransPromptConfig>();
	private readonly subscription: vscode.Disposable;
	private snapshot: TransPromptConfig;

	public readonly onDidChange = this.changeEmitter.event;

	constructor() {
		this.snapshot = readConfig();
		this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration(CONFIG_SECTION) == false) {
				return;
			}
			this.snapshot = readConfig();
			this.changeEmitter.fire(this.snapshot);
		});
	}

	public get current(): TransPromptConfig {
		return this.snapshot;
	}

	/**
	 * 설정을 Global 스코프에 기록한다.
	 * 기록이 끝나면 onDidChangeConfiguration이 발화하므로 호출부가 따로 재번역을 트리거할 필요는 없다.
	 */
	public async update(key: keyof TransPromptConfig, value: string): Promise<void> {
		const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await configuration.update(key, value, vscode.ConfigurationTarget.Global);
	}

	public dispose(): void {
		this.subscription.dispose();
		this.changeEmitter.dispose();
	}
}
