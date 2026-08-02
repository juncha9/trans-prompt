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
			nbsp: ' ',
		};
		return named[entity] ?? match;
	});
}

export type TranslateFailureKind =
	| 'auth'
	| 'quota'
	| 'rate_limit'
	| 'network'
	| 'bad_response'
	| 'cancelled'
	| 'unknown';

/**
 * 호출부가 `kind`로 분기한다 — 키가 잘못됐거나 쿼터를 소진했으면 사용자에게 알리고 멈춰야 하지만,
 * 일시적인 네트워크 오류는 조용히 넘기고 다음 청크를 계속 진행해야 하기 때문.
 */
export class TranslationError extends Error {
	public readonly kind: TranslateFailureKind;
	public readonly retryable: boolean;

	constructor(kind: TranslateFailureKind, retryable: boolean, message: string) {
		super(message);
		this.name = 'TranslationError';
		this.kind = kind;
		this.retryable = retryable;
	}
}

/** 재시도 간격. 429/5xx/네트워크 오류만 여기까지 올라간다 */
const RETRY_DELAYS_MS = [400, 1_200, 3_500] as const;

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Google v2의 error.errors[0].reason과 HTTP 상태로 실패 성격을 가른다 */
function classifyFailure(status: number, body: string): TranslationError {
	let reason = '';
	try {
		const parsed = JSON.parse(body) as { error?: { errors?: { reason?: string }[] } };
		reason = parsed.error?.errors?.[0]?.reason ?? '';
	}
	catch {
		reason = '';
	}

	if (reason === 'dailyLimitExceeded') {
		return new TranslationError('quota', false, 'daily translation quota exceeded');
	}
	if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
		return new TranslationError('rate_limit', true, 'translation rate limit hit');
	}
	if (status === 400 || status === 401 || status === 403) {
		return new TranslationError('auth', false, `translation request rejected (${status} ${reason})`);
	}
	if (status >= 500) {
		return new TranslationError('network', true, `translation service error (${status})`);
	}
	return new TranslationError('unknown', false, `translation failed (${status} ${reason})`);
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
	 * Translates multiple texts in one API call.
	 * Google Translate v2 accepts an array for `q` and returns translations in the same order.
	 *
	 * 재시도 가능한 실패(429 / 5xx / 네트워크)는 간격을 늘려가며 다시 시도하고,
	 * 그 외에는 즉시 TranslationError로 던진다.
	 */
	async translateBatch(
		texts: string[],
		targetLang: string,
		sourceLang: string = 'en',
		signal?: AbortSignal
	): Promise<string[]> {
		if (!this.apiKey) {
			throw new TranslationError('auth', false, 'Google Cloud Translation API key is not configured');
		}
		if (texts.length === 0) {
			return [];
		}

		let lastError: TranslationError | undefined;
		for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
			if (signal?.aborted === true) {
				throw new TranslationError('cancelled', false, 'translation cancelled');
			}
			try {
				const results = await this.requestOnce(texts, targetLang, sourceLang, signal);
				return results;
			}
			catch (error: unknown) {
				if (error instanceof TranslationError == false) {
					throw error;
				}
				lastError = error as TranslationError;
				if (lastError.retryable == false || attempt === RETRY_DELAYS_MS.length) {
					throw lastError;
				}
				await delay(RETRY_DELAYS_MS[attempt]);
			}
		}
		throw lastError ?? new TranslationError('unknown', false, 'translation failed');
	}

	private async requestOnce(
		texts: string[],
		targetLang: string,
		sourceLang: string,
		signal?: AbortSignal
	): Promise<string[]> {
		const url = `https://translation.googleapis.com/language/translate/v2?key=${this.apiKey}`;

		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ q: texts, target: targetLang, source: sourceLang, format: 'text' }),
				signal,
			});
		}
		catch (error: unknown) {
			if (signal?.aborted === true) {
				throw new TranslationError('cancelled', false, 'translation cancelled');
			}
			const message = error instanceof Error ? error.message : 'network error';
			throw new TranslationError('network', true, message);
		}

		if (response.ok == false) {
			const body = await response.text();
			throw classifyFailure(response.status, body);
		}

		const data = await response.json() as { data?: { translations?: { translatedText?: string }[] } };
		const translations = data.data?.translations;
		// 응답이 요청과 1:1 순서로 온다는 전제이므로 개수까지 검증한다
		if (Array.isArray(translations) == false || translations == null || translations.length !== texts.length) {
			throw new TranslationError('bad_response', false, 'unexpected response shape from Translation API');
		}

		return translations.map(entry => decodeHtmlEntities(entry.translatedText ?? ''));
	}
}
