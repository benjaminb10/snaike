// Test visuel : joue une partie automatique et prend des captures.
// Usage : node scripts/shoot.mjs [url] [dossier]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5288/';
const out = process.argv[3] ?? '.playwright-mcp';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];

async function run(name, viewport, touch) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: touch ? 3 : 2, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(url);
  await page.waitForSelector('#menu:not(.hidden)');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-menu.png` });
  await page.evaluate(() => document.getElementById('play-form').requestSubmit());
  const cx = viewport.width / 2, cy = viewport.height / 2;
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 9000) {
    // Pilote automatique : vise la nourriture la plus proche et évite la mort au maximum.
    await page.evaluate(() => {
      const w = window.game.world, p = w.player;
      if (!p || !p.alive) return;
      let best = null, bd = 1e12;
      for (const f of w.foods) { const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2 - (f.kind === 1 ? 200000 : 0); if (d < bd) { bd = d; best = f; } }
      if (best) window.__aim = Math.atan2(best.y - p.y, best.x - p.x);
    });
    const a = await page.evaluate(() => window.__aim ?? 0);
    if (!touch) await page.mouse.move(cx + Math.cos(a) * 200, cy + Math.sin(a) * 200);
    else await page.evaluate((a) => { window.game.input.angle = a; }, a);
    if (i === 25) await page.screenshot({ path: `${out}/${name}-early.png` });
    if (i === 40 && !touch) await page.mouse.down();
    if (i === 55 && !touch) await page.mouse.up();
    await page.waitForTimeout(100);
    i++;
  }
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { n++; performance.now() - s < 2000 ? requestAnimationFrame(f) : r(n / 2); }; requestAnimationFrame(f); }));
  await page.screenshot({ path: `${out}/${name}-play.png` });
  const st = await page.evaluate(() => { const p = window.game.world.player; return { alive: p.alive, score: p.score, humans: p.humans, logos: p.logos.length, snakes: window.game.world.snakes.length }; });
  console.log(name, 'fps', fps, JSON.stringify(st));
  // Force la mort pour voir l'écran de fin.
  await page.evaluate(() => { const w = window.game.world; const p = w.player; if (p.alive) { p.x = 9999; } });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/${name}-death.png` });
  await page.close();
}

await run('desktop', { width: 1440, height: 900 }, false);
await run('mobile', { width: 390, height: 844 }, true);
await browser.close();
console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur console');
