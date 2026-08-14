import { createEvalHandle, type EvalHandle } from 'gamera-hub/eval-handle';
import { Aborted, errorFromFrame, GameDisconnected } from 'gamera-hub/errors';
import { encode, parseFrame, PROTOCOL_VERSION } from 'gamera-hub/protocol';
import type { EvalOptions, GameClient, HelloInfo } from 'gamera-hub';

export interface BrowserClientOptions {
  path: string;
  WebSocket?: typeof WebSocket;
}

export function createBrowserClient(options: BrowserClientOptions): GameClient {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let seq = 0;
  let socket: WebSocket | undefined;
  let hello: HelloInfo | undefined;
  let closed = false;
  let attempt = 0;

  function emit(name: string, payload: unknown): void {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  }

  function socketUrl(): string {
    if (/^wss?:\/\//.test(options.path)) return options.path;
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof location !== 'undefined' ? location.host : '127.0.0.1';
    return `${proto}//${host}${options.path}`;
  }

  function connect(): void {
    if (closed) return;
    const next = new Socket(socketUrl());
    socket = next;
    next.addEventListener('open', () => { attempt = 0; });
    next.addEventListener('message', event => {
      const frame = parseFrame(String((event as MessageEvent).data));
      if (!frame) return;
      if (frame.kind === 'hello') {
        hello = {
          epoch: frame.epoch,
          agent: frame.agent,
          plugin: frame.plugin,
          game: frame.game,
          protocol: PROTOCOL_VERSION,
          handles: frame.handles,
        };
        emit('hello', hello);
        return;
      }
      if (frame.kind === 'ok') {
        pending.get(frame.id)?.resolve(frame.result);
        pending.delete(frame.id);
        return;
      }
      if (frame.kind === 'err') {
        pending.get(frame.id)?.reject(errorFromFrame(frame.error));
        pending.delete(frame.id);
        return;
      }
      if (frame.kind === 'event') emit(frame.name, frame.payload);
    });
    next.addEventListener('close', () => {
      for (const item of pending.values()) item.reject(new GameDisconnected());
      pending.clear();
      if (!closed) {
        const delay = Math.min(8000, 500 * 2 ** attempt);
        attempt += 1;
        setTimeout(connect, delay);
      }
    });
  }

  connect();

  const client: GameClient = {
    get connected() { return Boolean(socket && socket.readyState === 1 && hello); },
    get epoch() { return hello?.epoch ?? 0; },
    eval<T>(source: string, opts?: EvalOptions) {
      const id = `a${++seq}`;
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = value => res(value as T);
        reject = rej;
      });
      pending.set(id, { resolve, reject });
      socket?.send(encode({
        v: PROTOCOL_VERSION,
        kind: 'eval',
        id,
        epoch: opts?.epoch ?? hello?.epoch ?? 0,
        lane: opts?.lane,
        source,
      }));
      return createEvalHandle(id, promise, () => client.abort(id));
    },
    abort(id: string) {
      pending.get(id)?.reject(new Aborted());
      pending.delete(id);
      socket?.send(encode({ v: PROTOCOL_VERSION, kind: 'abort', id }));
    },
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener);
      return () => { set?.delete(listener); };
    },
    ready(timeoutMs = 30_000) {
      if (hello) return Promise.resolve(hello);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new GameDisconnected('ready timed out'));
        }, timeoutMs);
        const off = client.on('hello', payload => {
          clearTimeout(timer);
          off();
          resolve(payload as HelloInfo);
        });
      });
    },
  };
  return client;
}
