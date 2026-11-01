# SNAIKE

A slither.io-style multiplayer game (UI and content in English): the player is an AI (Claude, ChatGPT, Gemini, Grok…) that devours tiny humans and the icons of startups "replaced by AI". Logo: SN**AI**KE, with AI in acid green.

## Stack
- Vite + TypeScript, Canvas 2D rendering (pre-rendered sprites in `src/render/sprites.ts`), no game engine.
- The simulation is separate from rendering (`src/game/world.ts`) and runs both in the browser (solo) and on the server (multiplayer).
- Sounds are 100% synthesized (`src/audio.ts`), no audio files.
- Multiplayer: arenas of 40 connections, bots fill up to 24 snakes, 30 binary ticks per second (`src/net/protocol.ts`) with only what is near each player. Online client: `src/net/networld.ts` (extrapolation that replays turns, soft correction, clock offset from a sliding 3 s minimum). If no server answers within 3 s, the game falls back to a local solo arena.
- Shared server code: `server/room.ts` (an arena, transport-agnostic) and `server/sponsors.ts` (web standards Request/Response and Web Crypto, injected storage).
- Production server: Cloudflare Workers + Durable Objects on the free plan (`cf/worker.ts`, `wrangler.jsonc`). One arena = one Durable Object `arena-N` (the next one when full), running only while someone is connected; the sponsors API is a single Durable Object (SQLite storage). The client is static (Vercel) and reads the server address from `VITE_WS_URL` at build time.
- Free quota: 100,000 requests per day, and 20 incoming WebSocket messages count as 1. That is why the client only sends its input when it changes (at least 4 times per second, about 10 while playing): roughly 60 hours of cumulative play per day. Beyond that, connections fail and the game goes back to solo.
- Node server (`server/index.ts`, `ws`): used in development, and for a single-container deploy (Dockerfile, `fly.toml`) that serves `dist/` and `/ws`.

## Commands
- `npm run dev`: local client (pick a free port, e.g. `npx vite --port 5288`). In dev, the client connects to the game server at `ws://<host>:5289/ws`.
- `npm run server`: Node game server in dev (tsx watch, port 5289). `?solo` in the URL forces the offline arena.
- `npm run dev:cf` / `npm run deploy:cf`: Cloudflare server locally (port 8797) / in production.
- `npm run build`: tsc + client build in `dist/` + Node server bundled in `dist-server/index.mjs` (`npm start`).
- `npm run fetch-logos`: downloads the logos from `src/data/catalog.json` into `public/logos/`.
- `node scripts/multi.mjs [url]`: two headless browsers in the same arena (they see each other, FPS, bandwidth). Needs a dev build (`window.game`).
- `node scripts/shoot.mjs [url]`: automatic headless game (installed Chrome), desktop + mobile screenshots in `.playwright-mcp/`, FPS and console errors.
- `npx tsx scripts/coil-test.ts`: measures the hole left in the middle of a full-speed coil.

## Data
- `src/data/catalog.json`: playable AIs (colors, models = bot names) and victim startups (name + epitaph shown when eaten).
- Logos: svgl.app (color) first, otherwise Simple Icons (`si:<slug>`). Prefer svgl's "light" variant (dark logo): icons sit on a white background.

## Pitfalls
- Canvas context loss (GPU memory pressure, many tabs): the browser restores the canvas but every cached sprite canvas comes back blank, so the arena turns black while the DOM HUD keeps updating. `Renderer.rebuild()` clears the caches (`resetSprites()`) on `contextrestored` and via a `isContextLost()` watch. Any new sprite cache must be cleared there too.
- A browser tab in the background pauses requestAnimationFrame, so the game stops: test with `scripts/shoot.mjs`.
- `window.game` (world, renderer, input) only exists in dev, handy to drive tests.
- Dropped orbs: those from a death are permanent (only the `DROP_CAP` ceiling removes the oldest), boost orbs expire after 45 s. Do not give death remains a short lifetime: a player who encircles a snake must find the loot.
- On the server an arena runs for hours: anything that grows without limit ends up dominating (hence `BOT_MASS_SOFT_CAP`).
- Any food movement must go through `moveFood()` (shared client/server), and any server-side speed change must set `f.dirty = true`, otherwise the client drifts.
- Coil (`steer()` in world.ts, shared client/server): turning at full lock in the same direction tightens up to x1.8 (`COIL_BONUS`, `COIL_TURNS`), only after half a turn, to choke an encircled snake.
- Cloudflare: a Durable Object WebSocket receives binary as `Blob` by default (set `binaryType = 'arraybuffer'`), and its clock does not advance on its own between incoming messages: `fixedLoop` runs at least one tick per timer wake and only uses the clock to catch up. Ticks also arrive in bursts of about 100 ms, hence the sliding clock offset and the softer correction for other snakes. Smoothness metric: second difference of positions per frame (p95 ≈ 0.4 to 0.7 px).

## Sponsors and ads
- House products and plans: `src/sponsors-data.ts`. Placements: menu rail, game over card (plus a permanent "advertise" link), giant logo in the middle of the arena (Gold tier, 45 s rotation based on the clock). Client: `src/sponsors.ts`; server: `server/sponsors.ts` (paid sponsors and daily views/clicks per placement).
- Payment: `/api/checkout?tier=1|2|3` creates a Stripe Checkout session (19/49/99 USD, 30 days) with `branding_settings`. The brand is added by the `/api/stripe-webhook` webhook OR when the thank-you page calls `/api/sponsor-by-session` (which checks the session with Stripe): no hard dependency on the webhook.
- Server secrets: SPONSOR_SECRET, ADMIN_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (and PUBLIC_URL, the site that hosts the Advertise page).
- A sponsor's stats link: `advertise.html?id=<id>&key=<HMAC(id, SPONSOR_SECRET)>`. Global view: `/api/sponsor-stats?key=<ADMIN_KEY>`.
