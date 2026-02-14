import type { Memento } from 'vscode';

/**
 * General-purpose key-value cache store.
 * Uses VSCode Memento for persistent storage.
 */
export class Cache {
    private state: Memento;
    private namespace: string;

    constructor(globalState: Memento, namespace: string) {
        this.state = globalState;
        this.namespace = namespace;
    }

    private getKey(): string {
        return `cache:${this.namespace}`;
    }

    private getData(): Record<string, string> {
        return this.state.get<Record<string, string>>(this.getKey(), {});
    }

    /**
     * Retrieves a value from the cache.
     */
    get(key: string): string | undefined {
        const data = this.getData();
        return data[key];
    }

    /**
     * Stores a value in the cache.
     */
    async set(key: string, value: string): Promise<void> {
        const data = this.getData();
        data[key] = value;
        await this.state.update(this.getKey(), data);
    }

    /**
     * Deletes a single entry from the cache.
     */
    async delete(key: string): Promise<void> {
        const data = this.getData();
        delete data[key];
        await this.state.update(this.getKey(), data);
    }

    /**
     * Clears the cache.
     */
    async clear(): Promise<void> {
        await this.state.update(this.getKey(), {});
    }

    /**
     * Returns the number of entries in the cache.
     */
    get size(): number {
        return Object.keys(this.getData()).length;
    }
}
