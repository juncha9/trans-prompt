/**
 * Google Cloud Translation API client.
 */
export class GcpTranslator {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    /**
     * Translates text.
     * @param text - Text to translate
     * @param targetLang - Target language code (e.g. 'ko', 'ja', 'en')
     * @param sourceLang - Source language code (default: 'en')
     * @returns Translated text
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

            const data = await response.json() as any;

            if (!data.data?.translations?.[0]?.translatedText) {
                throw new Error('Invalid response from Translation API');
            }

            return data.data.translations[0].translatedText;
        } catch (error:any) {
            if (error instanceof Error) {
                throw new Error(`Translation failed: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Checks whether the API key is configured.
     */
    isConfigured(): boolean {
        return !!this.apiKey;
    }
}
