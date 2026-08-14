import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { attachHub, type GameraHub } from 'gamera-hub';
import type { Plugin, ViteDevServer } from 'vite';
import { setHub } from './runtime.ts';

export interface GameraDiscovery {
  url: string;
  token: string;
  pid: number;
  appUrl?: string;
}

export interface GameraGamePlugin {
  discoveryPath: string;
  agentPath?: string;
  writeDiscovery?(info: GameraDiscovery): void;
  facadesModule?: string;
}

export interface GameraPluginOptions {
  game: GameraGamePlugin;
  path?: string;
  host?: string;
  token?: string;
}

const VIRTUAL = 'virtual:gamera';
const VIRTUAL_SERVER = 'virtual:gamera/server';
const attached = new WeakMap<object, GameraHub>();

function isLoopbackAddress(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
}

function defaultWrite(path: string): (info: GameraDiscovery) => void {
  return info => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(info, null, 2), 'utf8');
  };
}

function attach(server: { httpServer?: unknown; config: { logger: { info: (msg: string) => void } } }, prefix: string, options: GameraPluginOptions): void {
  const http = server.httpServer as import('node:http').Server | null | undefined;
  if (!http) return;
  if (attached.has(http)) return;
  const token = options.token ?? randomBytes(32).toString('hex');
  const start = () => {
    const addr = http.address();
    if (!addr || typeof addr !== 'object') {
      throw new Error('gamera: http.address() is not bound; refuse to invent a port');
    }
    if (!isLoopbackAddress(addr.address)) {
      throw new Error(`gamera: refuse non-loopback listen ${addr.address} (set server.host = "127.0.0.1")`);
    }
    const hub = attachHub({ server: http, path: prefix, token });
    attached.set(http, hub);
    setHub(hub);
    const info: GameraDiscovery = {
      url: `ws://127.0.0.1:${addr.port}${prefix}/agent`,
      token,
      pid: process.pid,
      appUrl: `http://127.0.0.1:${addr.port}/`,
    };
    const write = options.game.writeDiscovery ?? defaultWrite(options.game.discoveryPath);
    write(info);
    server.config.logger.info(`[gamera] agent ${info.url}`);
  };
  if (http.listening) start();
  else http.once('listening', start);
}

export function gamera(options: GameraPluginOptions): Plugin {
  const prefix = options.path ?? '/__gamera';
  return {
    name: 'gamera',
    configureServer(server) {
      attach(server, prefix, options);
    },
    configurePreviewServer(server) {
      attach(server, prefix, options);
    },
    resolveId(id) {
      if (id === VIRTUAL) return `\0${VIRTUAL}`;
      if (id === VIRTUAL_SERVER) return `\0${VIRTUAL_SERVER}`;
    },
    load(id) {
      const facades = options.game.facadesModule;
      const wrap = facades
        ? `import { createFacades } from ${JSON.stringify(facades)}\nconst wrap = createFacades\n`
        : `const wrap = (c) => c\n`;
      if (id === `\0${VIRTUAL}`) {
        return `
          import { createBrowserClient } from 'gamera-client/browser'
          ${wrap}
          export const game = wrap(createBrowserClient(${JSON.stringify({ path: `${prefix}/app` })}))
        `;
      }
      if (id === `\0${VIRTUAL_SERVER}`) {
        return `
          import { getHub } from 'gamera-vite/runtime'
          ${wrap}
          export const game = wrap(getHub().createServerClient())
        `;
      }
    },
  };
}
