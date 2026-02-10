"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranslationCache = void 0;
const crypto = require("crypto");
const _defs_1 = require("./_defs");
const CACHE_KEY = `${_defs_1.PACKAGE_NAME}:translations`;
class TranslationCache {
    memory = new Map();
    state;
    constructor(globalState) {
        this.state = globalState;
        // globalState → 메모리로 로드 (시작 시 1회)
        const stored = this.state.get(CACHE_KEY, {});
        for (const [key, value] of Object.entries(stored)) {
            this.memory.set(key, value);
        }
    }
    hash(text, to) {
        return `${to}:${crypto.createHash('sha256').update(text).digest('hex')}`;
    }
    get(text, to) {
        return this.memory.get(this.hash(text, to));
    }
    async set(text, to, translation) {
        const key = this.hash(text, to);
        this.memory.set(key, translation);
        await this.persist();
    }
    async clear() {
        this.memory.clear();
        await this.state.update(CACHE_KEY, {});
    }
    get size() {
        return this.memory.size;
    }
    async persist() {
        const data = Object.fromEntries(this.memory);
        await this.state.update(CACHE_KEY, data);
    }
}
exports.TranslationCache = TranslationCache;
//# sourceMappingURL=cache.js.map