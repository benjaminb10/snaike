// Encarts sponsors côté navigateur : bandeau du menu, carte de fin, panneau géant au centre de l'arène.
// La liste vient du serveur (sponsors payants + produits maison) ; sans serveur, on garde les produits maison.
// Vues et clics sont comptés côté serveur pour pouvoir montrer des chiffres aux annonceurs.
import { wsUrl } from './net/url';
import { SPONSORS as HOUSE, type Sponsor } from './sponsors-data';

export type { Sponsor };

export const ADVERTISE_URL = `${import.meta.env.BASE_URL}advertise.html`;
export const CONTACT_URL = `https://wa.me/33651774359?text=${encodeURIComponent("Hi! I'd like to put my brand in SNAIKE.")}`;

let list: Sponsor[] = HOUSE;

export const apiBase = () => wsUrl().replace(/^ws/, 'http').replace(/\/ws$/, '');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const logoSrc = (s: Sponsor) => (/^https?:\/\//.test(s.logo) ? s.logo : `${import.meta.env.BASE_URL}${s.logo}`);

export function withSource(url: string, placement: string) {
  const u = new URL(url);
  if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'snaike');
  u.searchParams.set('utm_content', placement);
  return u.toString();
}

/** Charge la liste du serveur (2,5 s max). */
export async function loadSponsors() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${apiBase()}/api/sponsors`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const data = (await r.json()) as Sponsor[];
      if (Array.isArray(data) && data.length) list = data;
    }
  } catch {
    /* pas de serveur : produits maison */
  }
}

// ---------- Comptage ----------

const seen = new Set<string>();

function track(e: 'v' | 'c', id: string, p: string) {
  const body = JSON.stringify({ e, id, p });
  try {
    if (!navigator.sendBeacon?.(`${apiBase()}/api/sponsor-event`, body)) {
      void fetch(`${apiBase()}/api/sponsor-event`, { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* tant pis */
  }
}

/** Une vue par sponsor, emplacement et occasion (la clé dit ce qu'est une occasion). */
function view(id: string, p: string, occasion = '') {
  const k = `${id}|${p}|${occasion}`;
  if (seen.has(k)) return;
  seen.add(k);
  track('v', id, p);
}

// Les liens sponsors portent data-sp="id|emplacement" : un seul écouteur compte les clics.
addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest?.('a[data-sp]') as HTMLAnchorElement | null;
  if (!a) return;
  const [id, p] = a.dataset.sp!.split('|');
  track('c', id, p);
}, true);

const link = (s: Sponsor, p: string, cls: string, inner: string, extra = '') =>
  `<a class="${cls}" href="${esc(withSource(s.url, p))}" target="_blank" rel="noopener" data-sp="${esc(s.id)}|${p}" ${extra}>${inner}</a>`;

// ---------- Menu ----------

export function buildSponsorRail(el: HTMLElement) {
  el.innerHTML =
    `<span class="sp-label mono">BROUGHT TO YOU BY</span>` +
    list.map((s) => link(s, 'menu', 'sp-chip', `<img src="${esc(logoSrc(s))}" alt="" />${esc(s.name)}`, `style="--c:${esc(s.color)}" title="${esc(s.tagline)}"`)).join('') +
    `<a class="sp-chip sp-free" href="${ADVERTISE_URL}" target="_blank" rel="noopener">YOUR BRAND HERE?</a>`;
}

let menuShows = 0;
export function menuShown() {
  menuShows++;
  for (const s of list) view(s.id, 'menu', String(menuShows));
}

// ---------- Écran de fin ----------

let deaths = 0;
let turn = Math.floor(Math.random() * 100);

/** Un sponsor en rotation (les paliers Or deux fois plus souvent) ; toutes les 3 morts, l'appel aux annonceurs. */
export function fillDeathSponsor(el: HTMLElement) {
  deaths++;
  el.style.removeProperty('--c');
  // Lien permanent vers la page Advertise sous la carte (masqué quand la carte est déjà l'appel aux annonceurs).
  let own = el.nextElementSibling as HTMLAnchorElement | null;
  if (!own?.classList.contains('sp-own')) {
    own = document.createElement('a');
    own.className = 'sp-own mono';
    own.href = ADVERTISE_URL;
    own.target = '_blank';
    own.rel = 'noopener';
    own.textContent = 'YOUR BRAND ON THIS SCREEN? ADVERTISE IN SNAIKE →';
    el.after(own);
  }
  own.hidden = deaths % 3 === 0;
  if (deaths % 3 === 0) {
    el.className = 'sp-card sp-free';
    el.innerHTML =
      `<div class="sp-text"><div class="sp-kicker mono">NEXT SPONSOR IS YOU?</div><b>Your brand, eaten by every AI.</b><span>Logo in the menu, on this screen and giant in the arena.</span></div>` +
      `<a class="sp-cta" href="${ADVERTISE_URL}" target="_blank" rel="noopener">ADVERTISE HERE</a>`;
    return;
  }
  const pool = list.filter((s) => s.tier >= 2).flatMap((s) => (s.tier >= 3 ? [s, s] : [s]));
  if (!pool.length) return;
  const s = pool[turn++ % pool.length];
  el.className = 'sp-card';
  el.style.setProperty('--c', s.color);
  el.innerHTML =
    `<img src="${esc(logoSrc(s))}" alt="" />` +
    `<div class="sp-text"><div class="sp-kicker mono">GAME BROUGHT TO YOU BY</div><b>${esc(s.name)}</b><span>${esc(s.tagline)}</span></div>` +
    link(s, 'death', 'sp-cta', 'TRY IT');
  view(s.id, 'death', String(deaths));
}

// ---------- Panneau de l'arène ----------

export interface Billboard {
  sponsor: Sponsor;
  img: HTMLImageElement;
}

const imgs = new Map<string, HTMLImageElement>();
const BILLBOARD_SECONDS = 45;

/** Sponsor Or du moment, le même pour tous les joueurs (rotation sur l'horloge). */
export function currentBillboard(): Billboard | null {
  const gold = list.filter((s) => s.tier >= 3);
  if (!gold.length) return null;
  const s = gold[Math.floor(Date.now() / 1000 / BILLBOARD_SECONDS) % gold.length];
  let img = imgs.get(s.id);
  if (!img) {
    img = new Image();
    img.src = logoSrc(s);
    imgs.set(s.id, img);
  }
  return img.complete && img.naturalWidth ? { sponsor: s, img } : null;
}

let lifeId = 0;
export function newLife() {
  lifeId++;
}
/** Appelé quand le panneau est à l'écran pendant une partie. */
export function billboardSeen(b: Billboard) {
  view(b.sponsor.id, 'arena', String(lifeId));
}
