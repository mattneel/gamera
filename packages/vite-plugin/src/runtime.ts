import type { GameraHub } from 'gamera-hub';

let hub: GameraHub | undefined;

export function setHub(next: GameraHub): void {
  hub = next;
}

export function getHub(): GameraHub {
  if (!hub) throw new Error('gamera hub not attached');
  return hub;
}
