// Test multijoueur : deux navigateurs headless rejoignent la même arène.
// Prérequis : `npm run dev` (5288) et `npm run server` (5289).
// Usage : node scripts/multi.mjs [url] [dossier]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5288/';
const out = process.argv[3] ?? '.playwright-mcp';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(name, nick, key, viewport, touch) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: touch ? 3 : 2, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  const net = { bytes: 0, frames: 0 };
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { net.frames++; net.bytes += typeof f.payload === 'string' ? f.payload.length : f.payload.byteLength; }));
  await page.goto(url);
  await page.waitForSelector('#menu:not(.hidden)');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/multi-${name}-menu.png` });
  await page.keyboard.press(key);
  await page.fill('#nick', nick);
  await page.evaluate(() => document.getElementById('play-form').requestSubmit());
  await page.waitForFunction(() => window.game.world.player?.alive);
  return { page, name, net, viewport };
}

const autopilot = (c) => c.page.evaluate(() => {
  const w = window.game.world, p = w.player;
  if (!p || !p.alive) return;
  let best = null, bd = 1e12;
  for (const f of w.foods) { const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2; if (d < bd) { bd = d; best = f; } }
  if (best) window.game.input.angle = Math.atan2(best.y - p.y, best.x - p.x);
});

const a = await open('a', 'Alice', '1', { width: 1440, height: 900 }, false);
const b = await open('b', 'Bob', '4', { width: 390, height: 844 }, true);
const t0 = Date.now();
a.net.bytes = b.net.bytes = 0;
let seen = false;
let shot = false;
while (Date.now() - t0 < 10000) {
  await Promise.all([autopilot(a), autopilot(b)]);
  if (!seen) seen = await a.page.evaluate(() => window.game.world.ranking().some((s) => s.name === 'Bob' && s.isPlayer));
  if (!shot && Date.now() - t0 > 2500) {
    shot = true;
    for (const c of [a, b]) await c.page.screenshot({ path: `${out}/multi-${c.name}-early.png` });
  }
  await a.page.waitForTimeout(100);
}
console.log('Alice voit Bob dans le classement :', seen);
const secs = (Date.now() - t0) / 1000;
for (const c of [a, b]) {
  const fps = await c.page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { n++; performance.now() - s < 2000 ? requestAnimationFrame(f) : r(n / 2); }; requestAnimationFrame(f); }));
  const st = await c.page.evaluate(() => {
    const w = window.game.world, p = w.player;
    const humans = w.ranking().filter((s) => s.isPlayer).map((s) => s.name);
    return { online: w.online, alive: p?.alive, score: p?.score, eaten: p?.humans, snakesInView: w.snakes.length, foods: w.foods.length, playersInRanking: humans };
  });
  console.log(c.name, 'fps', fps, `${Math.round(c.net.bytes / secs / 1024)} KB/s`, JSON.stringify(st));
  await c.page.screenshot({ path: `${out}/multi-${c.name}-play.png` });
}
await browser.close();
console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur console');
