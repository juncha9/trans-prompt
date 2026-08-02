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
    /** 마지막 영속화 이후 변경이 있었는지. 읽기 전용으로만 쓰이는 네임스페이스를 매번 재직렬화하지 않기 위해 */
    private dirty = false;

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
        this.dirty = true;
        if (this.flushTimer != null) { clearTimeout(this.flushTimer); }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.dirty = false;
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
        this.dirty = false;
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
        // 바뀐 게 없으면 쓰지 않는다. Memento 갱신은 레코드 전체 재직렬화라 O(N)이다
        if (this.dirty == false) {
            return;
        }
        this.dirty = false;
        await this.state.update(this.getKey(), this.data);
    }

    /**
     * Returns the number of entries in the cache.
     */
    get size(): number {
        return Object.keys(this.data).length;
    }
}
