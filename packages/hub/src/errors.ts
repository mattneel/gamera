export class GameDisconnected extends Error {
  override readonly name = 'GameDisconnected';
  constructor(message = 'game disconnected') {
    super(message);
  }
}

export class StaleEpoch extends Error {
  override readonly name = 'StaleEpoch';
  constructor(readonly expected: number, readonly actual: number) {
    super(`stale epoch: expected ${expected}, got ${actual}`);
  }
}

export class StaleHandle extends Error {
  override readonly name = 'StaleHandle';
  constructor(message = 'stale handle') {
    super(message);
  }
}

export class MutationsDisabled extends Error {
  override readonly name = 'MutationsDisabled';
  constructor(message = 'mutations disabled') {
    super(message);
  }
}

export class Aborted extends Error {
  override readonly name = 'Aborted';
  readonly code = 'Aborted' as const;
  constructor(message = 'eval aborted') {
    super(message);
  }
}

export function errorFromFrame(error: { name?: string; message?: string; code?: string }): Error {
  const message = error.message ?? error.name ?? 'eval failed';
  if (error.code === 'Aborted' || error.name === 'Aborted') return new Aborted(message);
  if (error.code === 'StaleEpoch' || error.name === 'StaleEpoch') return new StaleEpoch(0, 0);
  if (error.code === 'StaleHandle' || error.name === 'StaleHandle') return new StaleHandle(message);
  if (error.code === 'MutationsDisabled' || error.name === 'MutationsDisabled') {
    return new MutationsDisabled(message);
  }
  if (error.code === 'Disconnected' || error.name === 'GameDisconnected') {
    return new GameDisconnected(message);
  }
  const thrown = new Error(message);
  thrown.name = error.name ?? 'Error';
  return thrown;
}
