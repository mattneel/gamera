import { parseDiscovery, readDiscovery, type Discovery } from './discovery.ts';
import { runEval } from './eval.ts';
import { createHandleTable, type HandleTable } from './handles.ts';
import { defaultIsUObject, NotSerializable, serialize } from './serialize.ts';

export type { Discovery } from './discovery.ts';
export { parseDiscovery, readDiscovery } from './discovery.ts';
export { runEval } from './eval.ts';
export { createHandleTable } from './handles.ts';
export type { HandleTable } from './handles.ts';
export { defaultIsUObject, NotSerializable, serialize } from './serialize.ts';

type Log = (...values: unknown[]) => void;

export interface AgentApi {
  send(name: string, payload?: unknown): void;
  track(disposer: () => void): void;
  handles: HandleTable;
  readonly epoch: number;
  log: { debug: Log; info: Log; warn: Log; error: Log; success?: Log };
  mutationsEnabled: boolean;
}

export interface AgentGameAdapter {
  createScope(agent: AgentApi): Record<string, unknown>;
  discoveryId: string;
  discoveryAbsPath: string;
  readDiscovery?(): Discovery;
  onEpoch?(bump: (reason: string) => void): () => void;
  createKillSwitch?(agent: AgentApi): { mount(): void; dispose(): void };
  plugin?: string;
  game?: string;
  WebSocket?: new (url: string) => AgentSocket;
}

export interface AgentSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: string, fn: (event?: { data?: unknown }) => void): void;
}

const MAX_SOURCE = 256 * 1024;
const BACKOFF = [500, 1000, 2000, 4000, 8000];

function nextEpoch(): number {
  const store = globalThis as { __gameraEpoch?: number };
  store.__gameraEpoch = (store.__gameraEpoch ?? 0) + 1;
  return store.__gameraEpoch;
}

export function createAgent(adapter: AgentGameAdapter): { start(): void; dispose(): void } {
  const handles = createHandleTable();
  const disposers: Array<() => void> = [];
  let epoch = 0;
  let socket: AgentSocket | undefined;
  let started = false;
  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let helloOk = false;
  let mutationsEnabled = true;
  const aborted = new Set<string>();
  let scope: Record<string, unknown> = {};

  const api: AgentApi = {
    send(name, payload) {
      send({ v: 1, kind: 'event', epoch, name, payload });
    },
    track(disposer) { disposers.push(disposer); },
    handles,
    get epoch() { return epoch; },
    log: {
      debug: (...values) => api.send('log', { level: 'debug', scope: 'gamera', message: values.map(String).join(' ') }),
      info: (...values) => api.send('log', { level: 'info', scope: 'gamera', message: values.map(String).join(' ') }),
      warn: (...values) => api.send('log', { level: 'warn', scope: 'gamera', message: values.map(String).join(' ') }),
      error: (...values) => api.send('log', { level: 'error', scope: 'gamera', message: values.map(String).join(' ') }),
    },
    get mutationsEnabled() { return mutationsEnabled; },
    set mutationsEnabled(value) { mutationsEnabled = value; },
  };

  function send(frame: unknown): void {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(frame));
  }

  function replyErr(id: string, error: { name: string; message: string; code?: string; stack?: string }): void {
    send({ v: 1, kind: 'err', id, epoch, error });
  }

  function loadDiscovery(): Discovery {
    if (adapter.readDiscovery) return parseDiscovery(adapter.readDiscovery());
    return readDiscovery(adapter.discoveryAbsPath, adapter.discoveryId);
  }

  function connect(): void {
    if (disposed || !started) return;
    let discovery: Discovery;
    try {
      discovery = loadDiscovery();
    } catch (error) {
      scheduleReconnect();
      return void error;
    }
    const Socket = adapter.WebSocket ?? (globalThis as { WebSocket?: new (url: string) => AgentSocket }).WebSocket;
    if (!Socket) {
      scheduleReconnect();
      return;
    }
    helloOk = false;
    handles.clear();
    const next = new Socket(discovery.url);
    socket = next;
    next.addEventListener('open', () => {
      attempt = 0;
      send({
        v: 1,
        kind: 'hello',
        token: discovery.token,
        epoch,
        agent: 'gamera-agent',
        plugin: adapter.plugin,
        game: adapter.game,
        handles: handles.size,
      });
    });
    next.addEventListener('message', event => {
      void onMessage(String((event as MessageEvent).data ?? event));
    });
    next.addEventListener('close', () => {
      if (socket === next) {
        socket = undefined;
        helloOk = false;
        scheduleReconnect();
      }
    });
    next.addEventListener('error', () => {
      try { next.close(); } catch { /* ignore */ }
    });
  }

  function scheduleReconnect(): void {
    if (disposed || !started) return;
    clearTimeout(reconnectTimer);
    const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] ?? 8000;
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  async function onMessage(raw: string): Promise<void> {
    let frame: { kind?: string; id?: string; source?: string; lane?: string; v?: number };
    try { frame = JSON.parse(raw) as typeof frame; }
    catch { return; }
    if (frame.v !== 1) {
      socket?.close(4002);
      return;
    }
    if (frame.kind === 'hello-ok') {
      helloOk = true;
      return;
    }
    if (frame.kind === 'ping') {
      send({ v: 1, kind: 'pong', t: Date.now() });
      return;
    }
    if (frame.kind === 'abort' && frame.id) {
      aborted.add(frame.id);
      return;
    }
    if (frame.kind !== 'eval' || !frame.id) return;
    if (!helloOk) return;
    const id = frame.id;
    if (frame.lane === 'mutation' && !mutationsEnabled) {
      replyErr(id, { name: 'MutationsDisabled', message: 'mutations disabled', code: 'MutationsDisabled' });
      return;
    }
    if (typeof frame.source !== 'string' || frame.source.length > MAX_SOURCE) {
      replyErr(id, { name: 'EvalError', message: 'source missing or over 256 KiB', code: 'EvalError' });
      return;
    }
    try {
      const result = await runEval(frame.source, scope);
      if (aborted.has(id)) {
        aborted.delete(id);
        replyErr(id, { name: 'Aborted', message: 'eval aborted', code: 'Aborted' });
        return;
      }
      const ue = scope.ue as { IsValid?: (value: unknown) => boolean } | undefined;
      send({
        v: 1,
        kind: 'ok',
        id,
        epoch,
        result: serialize(result, { handles, isUObject: defaultIsUObject(ue) }),
      });
    } catch (error) {
      if (aborted.has(id)) {
        aborted.delete(id);
        replyErr(id, { name: 'Aborted', message: 'eval aborted', code: 'Aborted' });
        return;
      }
      const thrown = error instanceof Error ? error : new Error(String(error));
      replyErr(id, {
        name: thrown.name,
        message: thrown.message,
        code: (thrown as { code?: string }).code,
        stack: thrown.stack,
      });
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      disposed = false;
      epoch = nextEpoch();
      handles.clear();
      scope = adapter.createScope(api);
      const kill = adapter.createKillSwitch?.(api);
      kill?.mount();
      if (kill) api.track(() => kill.dispose());
      const offEpoch = adapter.onEpoch?.(reason => {
        epoch = nextEpoch();
        handles.clear();
        api.send('epoch', { reason, handles: 0 });
      });
      if (offEpoch) api.track(offEpoch);
      connect();
    },
    dispose() {
      disposed = true;
      started = false;
      clearTimeout(reconnectTimer);
      while (disposers.length) {
        try { disposers.pop()?.(); } catch { /* ignore */ }
      }
      handles.clear();
      try { socket?.close(); } catch { /* ignore */ }
      socket = undefined;
    },
  };
}
