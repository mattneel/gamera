export interface HandleTable {
  retain(value: unknown): number;
  get(id: number): unknown;
  drop(id: number): void;
  has(id: number): boolean;
  clear(): void;
  readonly size: number;
}

export function createHandleTable(): HandleTable {
  const values = new Map<number, unknown>();
  let next = 1;
  return {
    retain(value) {
      const id = next++;
      values.set(id, value);
      return id;
    },
    get(id) {
      if (!values.has(id)) {
        const error = new Error(`stale handle ${id}`);
        error.name = 'StaleHandle';
        (error as { code?: string }).code = 'StaleHandle';
        throw error;
      }
      return values.get(id);
    },
    drop(id) { values.delete(id); },
    has(id) { return values.has(id); },
    clear() { values.clear(); },
    get size() { return values.size; },
  };
}
