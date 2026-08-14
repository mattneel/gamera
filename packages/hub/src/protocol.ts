export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PREFIX = '/__gamera';

export const CLOSE = {
  agentAlreadyConnected: 4000,
  unknownPath: 4001,
  badProtocol: 4002,
  badToken: 4003,
} as const;

export type Lane = 'read' | 'mutation';

export type ErrorCode =
  | 'EvalError'
  | 'StaleEpoch'
  | 'StaleHandle'
  | 'Aborted'
  | 'NotSerializable'
  | 'Unauthorized'
  | 'MutationsDisabled'
  | 'Disconnected';

export interface HelloFrame {
  v: 1;
  kind: 'hello';
  token: string;
  epoch: number;
  agent: string;
  plugin?: string;
  game?: string;
  handles?: number;
}

export interface HelloOkFrame {
  v: 1;
  kind: 'hello-ok';
  epoch: number;
  serverTime: number;
}

export interface EvalFrame {
  v: 1;
  kind: 'eval';
  id: string;
  epoch: number;
  lane?: Lane;
  source: string;
}

export interface AbortFrame {
  v: 1;
  kind: 'abort';
  id: string;
}

export interface OkFrame {
  v: 1;
  kind: 'ok';
  id: string;
  epoch: number;
  result: unknown;
}

export interface ErrFrame {
  v: 1;
  kind: 'err';
  id: string;
  epoch: number;
  error: {
    name: string;
    message: string;
    code?: ErrorCode;
    stack?: string;
  };
}

export interface EventFrame {
  v: 1;
  kind: 'event';
  epoch: number;
  name: string;
  payload?: unknown;
}

export interface PingFrame {
  v: 1;
  kind: 'ping';
  t: number;
}

export interface PongFrame {
  v: 1;
  kind: 'pong';
  t: number;
}

export type AgentToHub = HelloFrame | OkFrame | ErrFrame | EventFrame | PongFrame;
export type HubToAgent = HelloOkFrame | EvalFrame | AbortFrame | PingFrame;
export type AppToHub = EvalFrame | AbortFrame;
export type HubToApp = OkFrame | ErrFrame | EventFrame | HelloFrame | EventFrame;
export type Frame = AgentToHub | HubToAgent | AppToHub;

export function parseFrame(raw: string): Frame | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const frame = value as { v?: unknown; kind?: unknown };
  if (frame.v !== PROTOCOL_VERSION) return undefined;
  if (typeof frame.kind !== 'string') return undefined;
  return value as Frame;
}

export function encode(frame: Frame): string {
  return JSON.stringify(frame);
}
