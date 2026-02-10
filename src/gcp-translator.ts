/**
 * Google Cloud Translation API 클라이언트
 */
export class GcpTranslator {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    /**
     * 텍스트를 번역합니다.
     * @param text 번역할 텍스트
     * @param targetLang 대상 언어 코드 (예: 'ko', 'ja', 'en')
     * @param sourceLang 원본 언어 코드 (기본값: 'en')
     * @returns 번역된 텍스트
     */
    async translate(
        text: string,
        targetLang: string,
        sourceLang: string = 'en'
    ): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Google Cloud Translation API key is not configured');
        }

        const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: text,
                    target: targetLang,
                    source: sourceLang,
                    format: 'text'
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Translation API error: ${response.status} ${response.statusText} - ${error}`);
            }

            const data = await response.json();
            
            if (!data.data?.translations?.[0]?.translatedText) {
                throw new Error('Invalid response from Translation API');
            }

            return data.data.translations[0].translatedText;
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Translation failed: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * API 키가 설정되어 있는지 확인합니다.
     */
    isConfigured(): boolean {
        return !!this.apiKey;
    }
}
