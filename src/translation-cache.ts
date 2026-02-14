import * as crypto from 'crypto';
import type { Memento } from 'vscode';
import { Cache } from './cache';

/**
 * Translation-specific cache.
 * A specialized wrapper around the Cache class.
 */
export class TranslationCache {
    private cache: Cache;

    constructor(globalState: Memento) {
        this.cache = new Cache(globalState, 'translation');
    }

    /**
     * Generates a hash key from text and target language.
     */
    private hash(text: string, targetLang: string): string {
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        return `${targetLang}:${hash}`;
    }

    /**
     * Retrieves a cached translation.
     */
    get(text: string, targetLang: string): string | undefined {
        return this.cache.get(this.hash(text, targetLang));
    }

    /**
     * Stores a translation result in the cache.
     */
    async set(text: string, targetLang: string, translation: string): Promise<void> {
        await this.cache.set(this.hash(text, targetLang), translation);
    }

    /**
     * Deletes a single translation from the cache.
     */
    async delete(text: string, targetLang: string): Promise<void> {
        await this.cache.delete(this.hash(text, targetLang));
    }

    /**
     * Clears the translation cache.
     */
    async clear(): Promise<void> {
        await this.cache.clear();
    }

    /**
     * Returns the number of entries in the cache.
     */
    get size(): number {
        return this.cache.size;
    }
}
