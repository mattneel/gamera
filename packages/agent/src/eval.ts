export async function runEval(source: string, scope: Record<string, unknown>): Promise<unknown> {
  const names = Object.keys(scope);
  for (const name of names) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new Error(`scope key is not an IdentifierName: ${name}`);
    }
  }
  const body = `"use strict";\nreturn (async () => {\n${source}\n})();`;
  const fn = new Function(...names, body) as (...args: unknown[]) => Promise<unknown>;
  return await fn(...names.map(name => scope[name]));
}
