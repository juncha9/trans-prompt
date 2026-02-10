import type { Memento } from 'vscode';

/**
 * 범용 키-값 캐시 저장소
 * VSCode Memento를 사용한 영구 저장소입니다.
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
     * 캐시에서 값을 가져옵니다.
     */
    get(key: string): string | undefined {
        const data = this.getData();
        return data[key];
    }

    /**
     * 캐시에 값을 저장합니다.
     */
    async set(key: string, value: string): Promise<void> {
        const data = this.getData();
        data[key] = value;
        await this.state.update(this.getKey(), data);
    }

    /**
     * 캐시를 비웁니다.
     */
    async clear(): Promise<void> {
        await this.state.update(this.getKey(), {});
    }

    /**
     * 캐시 크기를 반환합니다.
     */
    get size(): number {
        return Object.keys(this.getData()).length;
    }
}
