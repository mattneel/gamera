import type { AgentApi } from 'gamera-agent';

function load(id: string): unknown {
  try {
    return (0, eval)('require')(id);
  } catch {
    return undefined;
  }
}

export function createScope(agent: AgentApi): Record<string, unknown> {
  const req = (0, eval)('require') as (id: string) => unknown;
  const ue = load('ue') as Record<string, unknown> | undefined;
  const cpp = load('cpp') as Record<string, unknown> | undefined;
  return {
    require: req,
    ue,
    cpp,
    context: load('./SharpMist/context'),
    hooks: load('./SharpMist/hooks'),
    events: load('./SharpMist/events'),
    logging: load('./SharpMist/logging'),
    resilience: load('./SharpMist/resilience'),
    oasis: ue?.OasisFileLibrary,
    http: cpp?.FHttpUtils,
    handles: agent.handles,
    agent,
  };
}
