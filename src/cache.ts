import { createHash } from 'crypto';
import type { Memento } from 'vscode';

const CACHE_KEY = 'prompt-translate-lens:translations';

interface CacheData {
    [hash: string]: string;
}

export class TranslationCache {
    private memory = new Map<string, string>();
    private state: Memento;

    constructor(globalState: Memento) {
        this.state = globalState;

        // globalState → 메모리로 로드 (시작 시 1회)
        const stored = this.state.get<CacheData>(CACHE_KEY, {});
        for (const [key, value] of Object.entries(stored)) {
            this.memory.set(key, value);
        }
    }

    private hash(text: string, to: string): string {
        return `${to}:${createHash('sha256').update(text).digest('hex')}`;
    }

    get(text: string, to: string): string | undefined {
        return this.memory.get(this.hash(text, to));
    }

    async set(text: string, to: string, translation: string): Promise<void> {
        const key = this.hash(text, to);
        this.memory.set(key, translation);
        await this.persist();
    }

    async clear(): Promise<void> {
        this.memory.clear();
        await this.state.update(CACHE_KEY, {});
    }

    get size(): number {
        return this.memory.size;
    }

    private async persist(): Promise<void> {
        const data: CacheData = Object.fromEntries(this.memory);
        await this.state.update(CACHE_KEY, data);
    }
}
