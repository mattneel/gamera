export interface Discovery {
  url: string;
  token: string;
  pid?: number;
  appUrl?: string;
}

export function parseDiscovery(raw: unknown): Discovery {
  if (!raw || typeof raw !== 'object') throw new Error('discovery is not an object');
  const record = raw as Record<string, unknown>;
  if (typeof record.url !== 'string' || typeof record.token !== 'string') {
    throw new Error('discovery missing url/token');
  }
  if (!record.url.startsWith('ws://127.0.0.1') && !record.url.startsWith('ws://[::1]')) {
    throw new Error('discovery url is not loopback');
  }
  return {
    url: record.url,
    token: record.token,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
    appUrl: typeof record.appUrl === 'string' ? record.appUrl : undefined,
  };
}

export function readDiscovery(absPath: string, relativeId: string): Discovery {
  try {
    const ue = requireUe();
    const files = ue?.OasisFileLibrary as { ReadFile?: (path: string) => string } | undefined;
    const raw = files?.ReadFile?.(absPath);
    if (typeof raw === 'string' && raw.charAt(0) === '{') return parseDiscovery(JSON.parse(raw));
  } catch { /* Oasis unavailable or unreadable */ }

  const puerts = (globalThis as { puerts?: { forceReload?: (key?: string) => void } }).puerts;
  if (puerts && typeof puerts.forceReload === 'function' && absPath) {
    puerts.forceReload(absPath);
    puerts.forceReload(absPath.replace(/\\/g, '/'));
    puerts.forceReload(absPath.replace(/\//g, '\\'));
  }
  return parseDiscovery(requireRelative(relativeId));
}

function requireUe(): { OasisFileLibrary?: unknown; IsValid?: (value: unknown) => boolean } | undefined {
  try {
    return (0, eval)('require')('ue') as { OasisFileLibrary?: unknown };
  } catch {
    return undefined;
  }
}

function requireRelative(id: string): unknown {
  return (0, eval)('require')(id);
}
