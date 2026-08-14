import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgent } from '../../agent/src/index.ts';
import { Aborted, attachHub, type GameraHub } from '../src/index.ts';

class TestSocket {
  readonly raw: WebSocket;
  constructor(url: string) {
    this.raw = new WebSocket(url);
  }
  get readyState() { return this.raw.readyState; }
  send(data: string) { this.raw.send(data); }
  close(code?: number) { this.raw.close(code); }
  addEventListener(type: string, fn: (event?: { data?: unknown }) => void) {
    if (type === 'open') this.raw.on('open', () => fn());
    if (type === 'message') this.raw.on('message', data => fn({ data: String(data) }));
    if (type === 'close') this.raw.on('close', () => fn());
    if (type === 'error') this.raw.on('error', () => fn());
  }
}

async function listen() {
  const server = createServer((_req, res) => res.end());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('no address');
  return { server, port: addr.port };
}

describe('hub + agent round trip', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  async function boot(scope: Record<string, unknown> = {}) {
    const { server, port } = await listen();
    const token = 'a'.repeat(64);
    const hub = attachHub({ server, token });
    const url = `ws://127.0.0.1:${port}/__gamera/agent`;
    const agent = createAgent({
      discoveryId: './.gamera.json',
      discoveryAbsPath: '/tmp/.gamera.json',
      readDiscovery: () => ({ url, token }),
      WebSocket: TestSocket,
      createScope: () => ({
        ue: {
          KismetSystemLibrary: { GetGameName: () => 'MistfallHunter' },
          IsValid: () => false,
        },
        ...scope,
      }),
    });
    cleanups.push(() => { agent.dispose(); hub.close(); server.close(); });
    agent.start();
    await hub.waitForAgent(5_000);
    return { hub, agent };
  }

  it('hellos and evals GetGameName', async () => {
    const { hub } = await boot();
    expect(hub.connected).toBe(true);
    expect(hub.hello?.handles).toBe(0);
    const name = await hub.eval('return ue.KismetSystemLibrary.GetGameName()');
    expect(name).toBe('MistfallHunter');
  });

  it('drops a second agent', async () => {
    const { server, port } = await listen();
    const token = 'b'.repeat(64);
    const hub = attachHub({ server, token });
    const url = `ws://127.0.0.1:${port}/__gamera/agent`;
    const make = () => createAgent({
      discoveryId: './.gamera.json',
      discoveryAbsPath: '/tmp/.gamera.json',
      readDiscovery: () => ({ url, token }),
      WebSocket: TestSocket,
      createScope: () => ({}),
    });
    const first = make();
    first.start();
    await hub.waitForAgent(5_000);
    const second = make();
    second.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(hub.connected).toBe(true);
    second.dispose();
    first.dispose();
    hub.close();
    server.close();
  });

  it('aborts an in-flight eval', async () => {
    const { hub } = await boot();
    const handle = hub.eval('await new Promise(resolve => setTimeout(resolve, 5000)); return 1');
    handle.abort();
    await expect(handle).rejects.toBeInstanceOf(Aborted);
  });

  it('increments epoch across start()', async () => {
    const { server, port } = await listen();
    const token = 'c'.repeat(64);
    const hub = attachHub({ server, token });
    const url = `ws://127.0.0.1:${port}/__gamera/agent`;
    const store = globalThis as { __gameraEpoch?: number };
    store.__gameraEpoch = 0;
    const agent = createAgent({
      discoveryId: './.gamera.json',
      discoveryAbsPath: '/tmp/.gamera.json',
      readDiscovery: () => ({ url, token }),
      WebSocket: TestSocket,
      createScope: () => ({}),
    });
    agent.start();
    const first = await hub.waitForAgent(5_000);
    expect(first.epoch).toBe(1);
    const nextHello = new Promise<number>(resolve => {
      const off = hub.on('hello', payload => {
        const epoch = (payload as { epoch?: number }).epoch;
        if (epoch && epoch > 1) {
          off();
          resolve(epoch);
        }
      });
    });
    agent.dispose();
    agent.start();
    expect(await nextHello).toBe(2);
    agent.dispose();
    hub.close();
    server.close();
  });

  it('serializes a Map of DTO rows as JSON', async () => {
    const { hub } = await boot({
      table: new Map([[1, { type: 1, nameId: 9 }]]),
    });
    const rows = await hub.eval('return table');
    expect(rows).toEqual([[1, { type: 1, nameId: 9 }]]);
  });
});
