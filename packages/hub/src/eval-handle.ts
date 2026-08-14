export interface EvalHandle<T> extends Promise<T> {
  readonly id: string;
  abort(): void;
}

export function createEvalHandle<T>(
  id: string,
  promise: Promise<T>,
  abort: () => void,
): EvalHandle<T> {
  const handle = promise as EvalHandle<T>;
  Object.defineProperty(handle, 'id', { value: id, enumerable: true });
  handle.abort = abort;
  return handle;
}
