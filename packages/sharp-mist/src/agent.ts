import { createAgent, type AgentGameAdapter } from 'gamera-agent';
import { createScope } from './scope.ts';

export function createSharpMistAdapter(options: {
  discoveryId?: string;
  discoveryAbsPath: string;
  killSwitch?: boolean;
  plugin?: string;
  game?: string;
}): AgentGameAdapter {
  return {
    discoveryId: options.discoveryId ?? './.gamera.json',
    discoveryAbsPath: options.discoveryAbsPath,
    plugin: options.plugin ?? 'gamera-sharp-mist',
    game: options.game,
    createScope,
    createKillSwitch: options.killSwitch === false
      ? undefined
      : agent => {
        let mounted = false;
        return {
          mount() {
            if (mounted) return;
            mounted = true;
            const gui = safeRequire('./SharpMist/gui') as {
              createWindow?: (id: string, opts: Record<string, unknown>) => {
                addButton: (opts: Record<string, unknown>) => unknown;
                remove: () => void;
              };
            } | undefined;
            const window = gui?.createWindow?.('gamera-kill', {
              title: 'Gamera',
              x: 16,
              y: 16,
              width: 220,
              height: 90,
            });
            window?.addButton({
              text: 'Disable mutations',
              onClick() {
                agent.mutationsEnabled = false;
                agent.send('kill', { mutationsEnabled: false });
              },
            });
            agent.track(() => { window?.remove(); });
          },
          dispose() { mounted = false; },
        };
      },
  };
}

function safeRequire(id: string): unknown {
  try { return (0, eval)('require')(id); }
  catch { return undefined; }
}

export function startFromInject(options: {
  discoveryAbsPath: string;
  discoveryId?: string;
  killSwitch?: boolean;
}): { start(): void; dispose(): void } {
  return createAgent(createSharpMistAdapter(options));
}
