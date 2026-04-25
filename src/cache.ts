import type { Memento } from 'vscode';

/**
 * General-purpose key-value cache store.
 * Holds an in-memory copy and flushes to VSCode Memento on a debounce
 * to avoid O(N) full-record writes on rapid sequential set() calls.
 */
export class Cache {
    private state: Memento;
    private namespace: string;
    private data: Record<string, string>;
    private flushTimer: NodeJS.Timeout | undefined;
    private flushDelayMs: number;

    constructor(globalState: Memento, namespace: string, flushDelayMs: number = 500) {
        this.state = globalState;
        this.namespace = namespace;
        this.flushDelayMs = flushDelayMs;
        this.data = { ...this.state.get<Record<string, string>>(this.getKey(), {}) };
    }

    private getKey(): string {
        return `cache:${this.namespace}`;
    }

    private scheduleFlush(): void {
        if (this.flushTimer != null) { clearTimeout(this.flushTimer); }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.state.update(this.getKey(), this.data);
        }, this.flushDelayMs);
    }

    /**
     * Retrieves a value from the cache.
     */
    get(key: string): string | undefined {
        return this.data[key];
    }

    /**
     * Stores a value in memory and schedules a persistent flush.
     */
    async set(key: string, value: string): Promise<void> {
        this.data[key] = value;
        this.scheduleFlush();
    }

    /**
     * Deletes a single entry and schedules a persistent flush.
     */
    async delete(key: string): Promise<void> {
        delete this.data[key];
        this.scheduleFlush();
    }

    /**
     * Clears the cache and persists immediately.
     */
    async clear(): Promise<void> {
        this.data = {};
        if (this.flushTimer != null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        await this.state.update(this.getKey(), {});
    }

    /**
     * Persists pending changes immediately (e.g. on deactivate).
     */
    async flush(): Promise<void> {
        if (this.flushTimer != null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        await this.state.update(this.getKey(), this.data);
    }

    /**
     * Returns the number of entries in the cache.
     */
    get size(): number {
        return Object.keys(this.data).length;
    }
}
