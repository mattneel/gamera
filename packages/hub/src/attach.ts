import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { Aborted, errorFromFrame, GameDisconnected, StaleEpoch } from './errors.ts';
import { createEvalHandle, type EvalHandle } from './eval-handle.ts';
import {
  CLOSE,
  DEFAULT_PREFIX,
  encode,
  parseFrame,
  PROTOCOL_VERSION,
  type ErrorCode,
  type HelloFrame,
  type Lane,
} from './protocol.ts';

export interface HelloInfo {
  epoch: number;
  agent: string;
  plugin?: string;
  game?: string;
  protocol: number;
  handles?: number;
}

export interface EvalOptions {
  timeoutMs?: number;
  lane?: Lane;
  epoch?: number;
}

export type HubEventName = 'hello' | 'disconnect' | 'epoch' | 'event' | 'log';

export interface GameClient {
  readonly connected: boolean;
  readonly epoch: number;
  eval<T = unknown>(source: string, opts?: EvalOptions): EvalHandle<T>;
  abort(id: string): void;
  on(name: string, listener: (payload: unknown) => void): () => void;
  ready(timeoutMs?: number): Promise<HelloInfo>;
}

export interface GameraHub {
  readonly connected: boolean;
  readonly epoch: number;
  readonly hello: HelloInfo | undefined;
  eval<T = unknown>(source: string, opts?: EvalOptions): EvalHandle<T>;
  abort(id: string): void;
  on(event: HubEventName, listener: (payload: unknown) => void): () => void;
  waitForAgent(timeoutMs?: number): Promise<HelloInfo>;
  createServerClient(): GameClient;
  close(): void;
}

export interface HubAttachOptions {
  server: HttpServer;
  path?: string;
  token: string;
  loopbackOnly?: boolean;
  evalTimeoutMs?: number;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra?: unknown) => void;
}

interface Pending {
  appId: string;
  agentId: string;
  source: string;
  lane: Lane;
  expectedEpoch?: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  aborted: boolean;
}

function isLoopbackAddress(host: string | undefined): boolean {
  if (!host) return false;
  return host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    return '';
  }
}

export function attachHub(options: HubAttachOptions): GameraHub {
  const prefix = (options.path ?? DEFAULT_PREFIX).replace(/\/$/, '') || DEFAULT_PREFIX;
  const timeoutMs = options.evalTimeoutMs ?? 30_000;
  const loopbackOnly = options.loopbackOnly !== false;
  const log = options.log ?? (() => undefined);

  const wss = new WebSocketServer({ noServer: true });
  const apps = new Set<WebSocket>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<string, Pending>();
  const appToAgent = new Map<string, string>();

  let agent: WebSocket | undefined;
  let hello: HelloInfo | undefined;
  let authed = false;
  let appSeq = 0;
  let agentSeq = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongWatch: ReturnType<typeof setTimeout> | undefined;
  let lastAgentTraffic = 0;
  let closed = false;

  function emit(name: string, payload: unknown): void {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  }

  function sendJson(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(encode(frame as never));
  }

  function fanout(frame: unknown): void {
    for (const socket of apps) sendJson(socket, frame);
  }

  function rejectAll(error: Error): void {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
    appToAgent.clear();
  }

  function settle(agentId: string, ok: boolean, value: unknown, epoch: number, err?: { name?: string; message?: string; code?: string }): void {
    const item = pending.get(agentId);
    if (!item) return;
    pending.delete(agentId);
    appToAgent.delete(item.appId);
    clearTimeout(item.timer);
    if (item.aborted) {
      item.reject(new Aborted());
      fanout({
        v: PROTOCOL_VERSION,
        kind: 'err',
        id: item.appId,
        epoch,
        error: { name: 'Aborted', message: 'eval aborted', code: 'Aborted' satisfies ErrorCode },
      });
      return;
    }
    if (ok) {
      item.resolve(value);
      fanout({ v: PROTOCOL_VERSION, kind: 'ok', id: item.appId, epoch, result: value });
    } else {
      const thrown = errorFromFrame(err ?? { message: 'eval failed' });
      item.reject(thrown);
      fanout({
        v: PROTOCOL_VERSION,
        kind: 'err',
        id: item.appId,
        epoch,
        error: {
          name: thrown.name,
          message: thrown.message,
          code: (err?.code as ErrorCode | undefined),
        },
      });
    }
  }

  function flushPending(): void {
    if (!agent || !authed || !hello) return;
    for (const item of pending.values()) {
      if (item.expectedEpoch !== undefined && item.expectedEpoch !== hello.epoch) {
        settle(item.agentId, false, undefined, hello.epoch, {
          name: 'StaleEpoch',
          message: `stale epoch: expected ${item.expectedEpoch}, got ${hello.epoch}`,
          code: 'StaleEpoch',
        });
        continue;
      }
      sendJson(agent, {
        v: PROTOCOL_VERSION,
        kind: 'eval',
        id: item.agentId,
        epoch: hello.epoch,
        lane: item.lane,
        source: item.source,
      });
    }
  }

  function armPing(): void {
    clearInterval(pingTimer);
    clearTimeout(pongWatch);
    pingTimer = setInterval(() => {
      if (!agent || !authed) return;
      if (Date.now() - lastAgentTraffic < 15_000) return;
      sendJson(agent, { v: PROTOCOL_VERSION, kind: 'ping', t: Date.now() });
      clearTimeout(pongWatch);
      pongWatch = setTimeout(() => {
        agent?.close();
      }, 10_000);
    }, 5_000);
  }

  function dropAgent(reason: string): void {
    clearInterval(pingTimer);
    clearTimeout(pongWatch);
    const wasAuthed = authed;
    authed = false;
    agent = undefined;
    if (wasAuthed) {
      rejectAll(new GameDisconnected(reason));
      emit('disconnect', { reason });
    }
  }

  function handleAgentMessage(raw: string): void {
    lastAgentTraffic = Date.now();
    clearTimeout(pongWatch);
    const frame = parseFrame(raw);
    if (!frame) return;
    if (!authed) {
      if (frame.kind !== 'hello') {
        agent?.close(CLOSE.badProtocol);
        return;
      }
      if (!tokensEqual(frame.token, options.token)) {
        agent?.close(CLOSE.badToken);
        return;
      }
      const previous = hello?.epoch;
      hello = {
        epoch: frame.epoch,
        agent: frame.agent,
        plugin: frame.plugin,
        game: frame.game,
        protocol: PROTOCOL_VERSION,
        handles: frame.handles ?? 0,
      };
      authed = true;
      sendJson(agent!, { v: PROTOCOL_VERSION, kind: 'hello-ok', epoch: hello.epoch, serverTime: Date.now() });
      emit('hello', hello);
      fanout(frame);
      if (previous !== undefined && previous !== hello.epoch) emit('epoch', hello);
      flushPending();
      armPing();
      return;
    }
    if (frame.kind === 'pong') return;
    if (frame.kind === 'ok') {
      settle(frame.id, true, frame.result, frame.epoch);
      return;
    }
    if (frame.kind === 'err') {
      settle(frame.id, false, undefined, frame.epoch, frame.error);
      return;
    }
    if (frame.kind === 'event') {
      emit(frame.name === 'log' ? 'log' : 'event', frame);
      if (frame.name === 'epoch') emit('epoch', frame.payload);
      fanout(frame);
    }
  }

  function handleAppMessage(socket: WebSocket, raw: string): void {
    const frame = parseFrame(raw);
    if (!frame) return;
    if (frame.kind === 'eval') {
      const handle = evalSource(frame.source, { lane: frame.lane, epoch: frame.epoch });
      const mapped = pending.get(appToAgent.get(handle.id) ?? '');
      if (mapped) {
        const originalResolve = mapped.resolve;
        const originalReject = mapped.reject;
        mapped.resolve = value => {
          sendJson(socket, { v: PROTOCOL_VERSION, kind: 'ok', id: frame.id, epoch: hello?.epoch ?? 0, result: value });
          originalResolve(value);
        };
        mapped.reject = error => {
          sendJson(socket, {
            v: PROTOCOL_VERSION,
            kind: 'err',
            id: frame.id,
            epoch: hello?.epoch ?? 0,
            error: { name: error.name, message: error.message, code: (error as { code?: ErrorCode }).code },
          });
          originalReject(error);
        };
      }
      return;
    }
    if (frame.kind === 'abort') hub.abort(frame.id);
  }

  function evalSource<T>(source: string, opts?: EvalOptions): EvalHandle<T> {
    const appId = `a${++appSeq}`;
    const agentId = String(++agentSeq);
    appToAgent.set(appId, agentId);
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = value => res(value as T);
      reject = rej;
    });
    const item: Pending = {
      appId,
      agentId,
      source,
      lane: opts?.lane ?? 'read',
      expectedEpoch: opts?.epoch,
      resolve,
      reject,
      aborted: false,
      timer: setTimeout(() => {
        item.aborted = true;
        if (agent && authed) sendJson(agent, { v: PROTOCOL_VERSION, kind: 'abort', id: agentId });
        settle(agentId, false, undefined, hello?.epoch ?? 0, { name: 'Aborted', message: 'eval timed out', code: 'Aborted' });
      }, opts?.timeoutMs ?? timeoutMs),
    };
    pending.set(agentId, item);
    if (hello && opts?.epoch !== undefined && opts.epoch !== hello.epoch) {
      settle(agentId, false, undefined, hello.epoch, {
        name: 'StaleEpoch',
        message: `stale epoch: expected ${opts.epoch}, got ${hello.epoch}`,
        code: 'StaleEpoch',
      });
    } else if (agent && authed && hello) {
      sendJson(agent, {
        v: PROTOCOL_VERSION,
        kind: 'eval',
        id: agentId,
        epoch: hello.epoch,
        lane: item.lane,
        source,
      });
    }
    return createEvalHandle(appId, promise, () => hub.abort(appId));
  }

  const hub: GameraHub = {
    get connected() { return Boolean(agent && authed); },
    get epoch() { return hello?.epoch ?? 0; },
    get hello() { return hello; },
    eval: evalSource,
    abort(id: string) {
      const agentId = appToAgent.get(id) ?? id;
      const item = pending.get(agentId);
      if (!item) return;
      item.aborted = true;
      if (agent && authed) sendJson(agent, { v: PROTOCOL_VERSION, kind: 'abort', id: agentId });
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => { set?.delete(listener); };
    },
    waitForAgent(waitMs = 30_000) {
      if (hello && authed) return Promise.resolve(hello);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new GameDisconnected('wait for agent timed out'));
        }, waitMs);
        const off = hub.on('hello', payload => {
          clearTimeout(timer);
          off();
          resolve(payload as HelloInfo);
        });
      });
    },
    createServerClient() {
      return {
        get connected() { return hub.connected; },
        get epoch() { return hub.epoch; },
        eval: hub.eval,
        abort: hub.abort,
        on: (name, listener) => hub.on(name as HubEventName, listener),
        ready: ms => hub.waitForAgent(ms),
      };
    },
    close() {
      if (closed) return;
      closed = true;
      options.server.off('upgrade', onUpgrade);
      dropAgent('hub closed');
      for (const socket of apps) socket.close();
      apps.clear();
      wss.close();
    },
  };

  function accept(socket: WebSocket, role: 'agent' | 'app'): void {
    if (role === 'agent') {
      if (agent && agent.readyState === agent.OPEN) {
        socket.close(CLOSE.agentAlreadyConnected, 'agent already connected');
        return;
      }
      agent = socket;
      authed = false;
      lastAgentTraffic = Date.now();
      socket.on('message', data => handleAgentMessage(String(data)));
      socket.on('close', () => {
        if (agent === socket) dropAgent('agent closed');
      });
      socket.on('error', () => {
        if (agent === socket) dropAgent('agent error');
      });
      return;
    }
    apps.add(socket);
    if (hello) {
      const replay: HelloFrame = {
        v: PROTOCOL_VERSION,
        kind: 'hello',
        token: '',
        epoch: hello.epoch,
        agent: hello.agent,
        plugin: hello.plugin,
        game: hello.game,
        handles: hello.handles,
      };
      sendJson(socket, replay);
    }
    socket.on('message', data => handleAppMessage(socket, String(data)));
    socket.on('close', () => { apps.delete(socket); });
  }

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = pathnameOf(req.url);
    if (!path.startsWith(prefix)) return;
    if (loopbackOnly && !isLoopbackAddress(req.socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    const role = path === `${prefix}/agent` ? 'agent' : path === `${prefix}/app` ? 'app' : undefined;
    if (!role) {
      wss.handleUpgrade(req, socket, head, ws => {
        ws.close(CLOSE.unknownPath, 'unknown path');
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => accept(ws, role));
  }

  options.server.on('upgrade', onUpgrade);
  log('info', 'hub attached', { prefix });
  return hub;
}
