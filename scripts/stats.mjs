// Vues et clics des sponsors, par emplacement (vue admin de /api/sponsor-stats).
// Usage : ADMIN_KEY=… node scripts/stats.mjs [https://serveur-de-jeu]
const base = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:5289').replace(/\/$/, '');
const key = process.env.ADMIN_KEY;
if (!key) throw new Error('ADMIN_KEY manquant');
const r = await fetch(`${base}/api/sponsor-stats?key=${encodeURIComponent(key)}`);
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const rows = (await r.json()).sort((a, b) => b.views - a.views);
const pct = (c, v) => (v ? ((c / v) * 100).toFixed(1) + ' %' : '-');
console.table(Object.fromEntries(rows.map((s) => [s.id, {
  vues: s.views, clics: s.clicks, ctr: pct(s.clicks, s.views),
  ...Object.fromEntries(Object.entries(s.byPlacement).map(([p, [v, c]]) => [p, `${v} / ${c}`])),
}])));
