import * as crypto from 'crypto';
import type { Memento } from 'vscode';
import { Cache } from './cache';

/**
 * 번역 전용 캐시
 * Cache 클래스의 특화된 래퍼입니다.
 */
export class TranslationCache {
    private cache: Cache;

    constructor(globalState: Memento) {
        this.cache = new Cache(globalState, 'translation');
    }

    /**
     * 텍스트와 언어로 해시 키를 생성합니다.
     */
    private hash(text: string, targetLang: string): string {
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        return `${targetLang}:${hash}`;
    }

    /**
     * 번역 캐시를 조회합니다.
     */
    get(text: string, targetLang: string): string | undefined {
        return this.cache.get(this.hash(text, targetLang));
    }

    /**
     * 번역 결과를 캐시에 저장합니다.
     */
    async set(text: string, targetLang: string, translation: string): Promise<void> {
        await this.cache.set(this.hash(text, targetLang), translation);
    }

    /**
     * 번역 캐시를 비웁니다.
     */
    async clear(): Promise<void> {
        await this.cache.clear();
    }

    /**
     * 캐시 크기를 반환합니다.
     */
    get size(): number {
        return this.cache.size;
    }
}
