// Page Advertise : offres + liens Stripe, remerciement après paiement, tableau de bord privé d'un sponsor.
import './advertise.css';
import { CONTACT_URL, apiBase } from './sponsors';
import { SPONSOR_DAYS, TIERS } from './sponsors-data';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-US');
const q = new URLSearchParams(location.search);
const api = apiBase();
const PLACE_NAMES: Record<string, string> = { menu: 'Menu rail', death: 'Game over card', arena: 'Arena billboard', advertise: 'This page' };

($('contact') as HTMLAnchorElement).href = CONTACT_URL;

function show(id: 'pitch' | 'thanks' | 'stats') {
  for (const s of ['pitch', 'thanks', 'stats']) $(s).hidden = s !== id;
}

// ---------- Offres ----------

function pitch() {
  show('pitch');
  $('tiers').innerHTML = TIERS.map(
    (t) => `
    <div class="tier${t.tier === 3 ? ' gold' : ''}">
      ${t.tier === 3 ? '<div class="badge mono">MOST SEEN</div>' : ''}
      <div class="tier-name mono">${esc(t.name.toUpperCase())}</div>
      <div class="price">${esc(t.price)}<span>/ ${SPONSOR_DAYS} days</span></div>
      <ul>${t.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <a class="btn" href="${esc(`${api}/api/checkout?tier=${t.tier}`)}">GET ${esc(t.name.toUpperCase())}</a>
    </div>`,
  ).join('');
  fetch(`${api}/api/reach`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no server'))))
    .then((d: { views: number; clicks: number } | null) => {
      if (d && d.views >= 500) $('reach').innerHTML = `<b>${fmt(d.views)}</b> sponsor impressions and <b>${fmt(d.clicks)}</b> clicks in the last 30 days`;
    })
    .catch(() => {
      // Pas de serveur de jeu joignable : le paiement passe par un message en attendant.
      for (const b of document.querySelectorAll<HTMLAnchorElement>('.tier .btn')) {
        b.href = CONTACT_URL;
        b.target = '_blank';
        b.textContent = 'CONTACT US';
      }
    });
}

// ---------- Après paiement ----------

async function thanks(session: string) {
  show('thanks');
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${api}/api/sponsor-by-session?session=${encodeURIComponent(session)}`);
      if (r.ok) {
        const d = (await r.json()) as { id: string; name: string; key: string };
        const url = `${location.pathname}?id=${encodeURIComponent(d.id)}&key=${d.key}`;
        $('thanks-text').innerHTML = `<b>${esc(d.name)}</b> is live in the game. Bookmark your private stats link to follow your views and clicks.`;
        const a = $('thanks-link') as HTMLAnchorElement;
        a.href = url;
        a.hidden = false;
        return;
      }
    } catch {
      /* on réessaie */
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  $('thanks-text').innerHTML = `Your payment went through but your campaign isn't set up yet. <a href="${esc(CONTACT_URL)}" target="_blank" rel="noopener">Message us</a> and we'll fix it right away.`;
}

// ---------- Tableau de bord ----------

interface Stats {
  name: string;
  views: number;
  clicks: number;
  until: number | null;
  byPlacement: Record<string, [number, number]>;
  days: Record<string, Record<string, [number, number]>>;
}

async function stats(id: string, key: string) {
  show('stats');
  const r = await fetch(`${api}/api/sponsor-stats?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`).catch(() => null);
  if (!r?.ok) {
    $('st-name').textContent = 'Link not valid';
    $('st-until').textContent = 'Check that you copied the whole link.';
    return;
  }
  const d = (await r.json()) as Stats;
  $('st-name').innerHTML = esc(d.name);
  $('st-until').textContent = d.until
    ? d.until > Date.now()
      ? `Live in the game until ${new Date(d.until).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
      : 'Campaign ended. Renew it from the plans page.'
    : 'House brand.';
  const ctr = d.views ? ((d.clicks / d.views) * 100).toFixed(1) + '%' : '-';
  $('st-kpis').innerHTML = [
    [fmt(d.views), 'views'],
    [fmt(d.clicks), 'clicks'],
    [ctr, 'click rate'],
  ].map(([v, l]) => `<div><b>${v}</b><span class="mono">${l}</span></div>`).join('');

  // 14 derniers jours
  const days: [string, number, number][] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    let v = 0;
    let c = 0;
    for (const [pv, pc] of Object.values(d.days[day] ?? {})) {
      v += pv;
      c += pc;
    }
    days.push([day, v, c]);
  }
  const max = Math.max(1, ...days.map((x) => x[1]));
  $('st-chart').innerHTML =
    `<div class="chart-head mono"><span>VIEWS, LAST 14 DAYS</span></div><div class="bars">` +
    days.map(([day, v, c]) => `<div title="${day}: ${fmt(v)} views, ${fmt(c)} clicks"><i style="height:${Math.max(2, (v / max) * 100)}%"></i><span class="mono">${day.slice(8)}</span></div>`).join('') +
    `</div>`;
  $('st-places').innerHTML = Object.entries(d.byPlacement)
    .sort((a, b) => b[1][0] - a[1][0])
    .map(([p, [v, c]]) => `<div><span>${esc(PLACE_NAMES[p] ?? p)}</span><b class="mono">${fmt(v)} views · ${fmt(c)} clicks</b></div>`)
    .join('');
}

const session = q.get('session_id');
const id = q.get('id');
const key = q.get('key');
if (session) void thanks(session);
else if (id && key) void stats(id, key);
else pitch();
if (q.get('error') === 'checkout') $('reach').innerHTML = `Payment page unavailable right now. <a href="${esc(CONTACT_URL)}" target="_blank" rel="noopener">Message us</a> and we'll set you up.`;
