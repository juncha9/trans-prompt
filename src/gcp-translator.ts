/**
 * Decodes HTML entities returned by Google Translate v2 REST API.
 * Even with format:'text', responses may include entities like &#39;, &amp;, &quot;.
 */
function decodeHtmlEntities(input: string): string {
    return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
            const code = parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith('#')) {
            const code = parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        const named: Record<string, string> = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
        };
        return named[entity] ?? match;
    });
}

/**
 * Google Cloud Translation API client.
 */
export class GcpTranslator {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    /**
     * Translates a single text.
     */
    async translate(
        text: string,
        targetLang: string,
        sourceLang: string = 'en'
    ): Promise<string> {
        const [result] = await this.translateBatch([text], targetLang, sourceLang);
        return result;
    }

    /**
     * Translates multiple texts in one API call.
     * Google Translate v2 accepts an array for `q` and returns translations in the same order.
     */
    async translateBatch(
        texts: string[],
        targetLang: string,
        sourceLang: string = 'en'
    ): Promise<string[]> {
        if (!this.apiKey) {
            throw new Error('Google Cloud Translation API key is not configured');
        }
        if (texts.length === 0) { return []; }

        const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: texts,
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
            const translations = data.data?.translations;
            if (!Array.isArray(translations) || translations.length !== texts.length) {
                throw new Error('Invalid response from Translation API');
            }

            return translations.map((t: any) => decodeHtmlEntities(t.translatedText ?? ''));
        } catch (error: any) {
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
