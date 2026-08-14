import { startFromInject } from './agent.ts';

declare const __GAMERA_DISCOVERY_ABS__: string;

const app = startFromInject({
  discoveryAbsPath: typeof __GAMERA_DISCOVERY_ABS__ === 'string'
    ? __GAMERA_DISCOVERY_ABS__
    : '',
});

export function start(): void { app.start(); }
export function dispose(): void { app.dispose(); }
