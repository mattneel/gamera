import type { GameClient, GameraHub } from 'gamera-hub';

export function createServerClient(hub: GameraHub): GameClient {
  return hub.createServerClient();
}
