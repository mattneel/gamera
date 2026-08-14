import { game } from 'virtual:gamera';

const status = document.getElementById('status');
const out = document.getElementById('out');

try {
  const hello = await game.ready(60_000);
  if (status) status.textContent = `connected epoch ${hello.epoch}`;
  const name = await game.eval('return ue.KismetSystemLibrary.GetGameName()');
  if (out) out.textContent = JSON.stringify({ hello, name }, null, 2);
} catch (error) {
  if (status) status.textContent = 'failed';
  if (out) out.textContent = String(error);
}

declare module 'virtual:gamera' {
  export const game: import('gamera-client').GameClient;
}
