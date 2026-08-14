import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SharpMistPluginOptions {
  scriptsDir: string;
  discoveryPath?: string;
  agentPath?: string;
  killSwitch?: boolean;
}

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
}

export default function sharpMist(options: SharpMistPluginOptions): GameraGamePlugin {
  const discoveryPath = options.discoveryPath ?? join(options.scriptsDir, '.gamera.json');
  return {
    discoveryPath,
    agentPath: options.agentPath ?? join(options.scriptsDir, 'GameraAgent.cjs'),
    writeDiscovery(info) {
      mkdirSync(dirname(discoveryPath), { recursive: true });
      writeFileSync(discoveryPath, JSON.stringify(info, null, 2), 'utf8');
    },
  };
}
