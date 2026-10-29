/**
 * Minimal browser shims so storage modules can run under node:test.
 * Import this first in any test that touches lib/reader-storage.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  keys(): string[] {
    return Array.from(this.store.keys());
  }
}

export const memoryStorage = new MemoryStorage();

(globalThis as any).localStorage = memoryStorage;
(globalThis as any).window = globalThis;
