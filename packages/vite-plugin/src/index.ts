import type { Plugin, ViteDevServer } from 'vite';

export interface GameraGamePlugin {
  /** Written next to the inject so the agent can require() the listen URL. */
  discoveryPath: string;
  agentPath?: string;
}

export interface GameraPluginOptions {
  game: GameraGamePlugin;
  path?: string;
  host?: string;
}

const VIRTUAL = 'virtual:gamera';
const VIRTUAL_SERVER = 'virtual:gamera/server';

/**
 * Attach the Gamera hub to Vite's HTTP server.
 * Browser: `virtual:gamera`. SSR / middleware: `virtual:gamera/server`.
 */
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
      if (id === `\0${VIRTUAL}`) {
        return `export { game } from '/@gamera/client/browser?prefix=${prefix}';\n`;
      }
      if (id === `\0${VIRTUAL_SERVER}`) {
        return `export { game } from '/@gamera/client/server';\n`;
      }
    },
  };
}

function attach(_server: ViteDevServer, _prefix: string, _options: GameraPluginOptions): void {
  // Hub attach + write the game plugin's discovery file once httpServer is listening.
}
