# Gamera

Vite is the host. The game is a plugin. The injected runtime only dials out.

Game clients often cannot listen (`http`, `HttpServerModule`, and friends). Many can connect out and run JS. Gamera is that pipe: a hub, a client, a Vite plugin, and a per-game agent adapter. Application code looks like a normal local API.

```ts
import { game } from 'virtual:gamera'

const name = await game.eval('return ue.KismetSystemLibrary.GetGameName()')
```

## Games are plugins

Core does not know Mistfall, Steam, or TradeCtrl. A game plugin supplies the only title-specific pieces:

| Side | Plugin provides |
|---|---|
| Agent (bundled into the inject) | Bound scope (`require`, `ue`, `cpp`, …), discovery path, epoch/travel, optional kill switch |
| Host (Vite / Node) | How to write the discovery file, optional typed facades (`trade.my()`) |

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gamera } from 'gamera/vite'
import sharpMist from 'gamera-sharp-mist'

export default defineConfig({
  plugins: [
    gamera({
      game: sharpMist({
        scriptsDir: 'C:/Users/you/Documents/Sharp Mist/Scripts',
      }),
    }),
  ],
})
```

A second PuerTS title is another plugin with a different `createScope()` and drop path. Typed APIs (`trade`, inventory) live in the game plugin or the app, never in core.

```text
  agent (game plugin + generic eval loop)
         \
          \  /__gamera/agent
           \                     virtual:gamera          (browser)
            +------ hub -------- virtual:gamera/server   (SSR / API)
           /
  Vite plugin (attach + discovery file)
```

## Why Vite

Vite already is a local HTTP server, a WebSocket upgrade target, and a framework-shaped hole. React, Vue, Svelte, Solid, vanilla, and Vite SSR / Hono / Express middleware mode all sit on `configureServer`. The plugin attaches the hub. You do not run a second Node server.

## Packages

```text
packages/hub           session, eval queue, epoch, events
packages/client        game.eval / game.on (browser WS + server in-process)
packages/vite-plugin   configureServer, virtual modules
packages/agent         generic inject: connect, eval, handles, cleanup
packages/sharp-mist    first game plugin (scope + Scripts/.gamera.json)
```

## Security

- Bind Vite to `127.0.0.1`.
- One agent socket; drop extras.
- Handshake token in the discovery file.
- Do not ship a generic eval agent to a public script store.

## Status

Hub, agent, client, Vite plugin, and Sharp Mist adapter are implemented. `npm test` covers serialize and a Node hello/eval round-trip.

```powershell
npm install
npm test
cd examples/hello
npx vite --host 127.0.0.1
```

Then build and Start `GameraAgent.cjs` from Sharp Mist (`npm run build --workspace gamera-sharp-mist`).
