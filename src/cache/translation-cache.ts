import * as crypto from 'crypto';
import type { Memento } from 'vscode';
import { Cache } from './cache';

/** 세그먼트 단위로 바뀌면서 키의 의미가 달라졌다. v1 엔트리와 섞이지 않도록 네임스페이스를 나눈다 */
const NAMESPACE = 'translation-v2';
const LEGACY_NAMESPACE = 'translation';

/**
 * 번역 전용 캐시.
 *
 * 키는 `${targetLang}:${sha256(text)}`이고, text는 번역기에 실제로 보낸 **마스킹된** 문자열이다.
 * 마스킹 상태로 저장해야 `Run <sentinel> first` 엔트리 하나가
 * `npm i` / `yarn add` 문서에서 함께 재사용된다.
 */
export class TranslationCache {
	private readonly cache: Cache;
	private readonly legacy: Cache;
	private legacyHits = 0;

	constructor(globalState: Memento) {
		this.cache = new Cache(globalState, NAMESPACE);
		this.legacy = new Cache(globalState, LEGACY_NAMESPACE);
	}

	private hash(text: string, targetLang: string): string {
		const hash = crypto.createHash('sha256').update(text).digest('hex');
		return `${targetLang}:${hash}`;
	}

	/**
	 * v2에서 못 찾으면 v1 네임스페이스를 한 번 더 본다.
	 *
	 * v1은 라인 단위 캐시였으므로, 세그먼트가 마침 마크업 없는 한 줄 문장이면 키가 그대로 맞는다.
	 * 회수율 자체는 높지 않지만, 기존 사용자가 확장을 켜자마자 문서 전체를 재번역해
	 * 과금되는 최악을 막는 게 목적이다. 히트한 값은 v2로 옮겨 적는다.
	 */
	get(text: string, targetLang: string): string | undefined {
		const key = this.hash(text, targetLang);
		const hit = this.cache.get(key);
		if (hit != null) {
			return hit;
		}
		const legacyHit = this.legacy.get(key);
		if (legacyHit == null) {
			return undefined;
		}
		void this.cache.set(key, legacyHit);
		this.legacyHits += 1;
		return legacyHit;
	}

	async set(text: string, targetLang: string, translation: string): Promise<void> {
		await this.cache.set(this.hash(text, targetLang), translation);
	}

	async delete(text: string, targetLang: string): Promise<void> {
		const key = this.hash(text, targetLang);
		await this.cache.delete(key);
		await this.legacy.delete(key);
	}

	async clear(): Promise<void> {
		await this.cache.clear();
		await this.legacy.clear();
	}

	async flush(): Promise<void> {
		await this.cache.flush();
		await this.legacy.flush();
	}

	get size(): number {
		return this.cache.size;
	}

	/** 이번 세션에서 v1 캐시를 재사용한 횟수 — 마이그레이션 효과 확인용 */
	get legacyHitCount(): number {
		return this.legacyHits;
	}
}
