import { BRANDS, VICTIMS, logoUrl, type Brand } from './data/brands';
import { WORLD_R } from './game/config';
import type { ArenaView, Snake } from './game/world';
import { faceFor, pickShout, pop as popFace } from './pop';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-US');

export function setBrandColor(brand: Brand) {
  document.documentElement.style.setProperty('--brand', brand.glow === '#FFFFFF' ? '#F4F4F8' : brand.glow);
}

// ---------- Chargement ----------

export function loaderProgress(p: number) {
  const pct = Math.round(p * 100);
  ($('loader').querySelector('.loader-bar i') as HTMLElement).style.width = pct + '%';
  $('loader').querySelector('.loader-text b')!.textContent = pct + '%';
}

// ---------- Menu ----------

export function buildMenu(selected: string, onPick: (b: Brand) => void) {
  const picker = $('picker');
  picker.innerHTML = '';
  BRANDS.forEach((b, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pick' + (b.id === selected ? ' on' : '');
    el.style.setProperty('--c', b.glow === '#FFFFFF' ? '#F4F4F8' : b.glow);
    el.style.animationDelay = `${0.15 + i * 0.04}s`;
    el.dataset.id = b.id;
    el.innerHTML = `<img src="${logoUrl(b.id)}" alt=""><span><span class="pk-name">${b.name}</span><span class="pk-maker">${b.maker}</span></span><span class="pk-key">${i + 1}</span>`;
    el.addEventListener('click', () => onPick(b));
    picker.appendChild(el);
  });

  // Bandeau défilant des startups au menu (doublé pour une boucle sans couture).
  const items = VICTIMS.map((v) => `<span><img src="${logoUrl(v.id)}" alt=""><s>${esc(v.name)}</s></span>`).join('');
  $('ticker').innerHTML = items + items;
}

export function markPicked(id: string) {
  for (const el of Array.from($('picker').children) as HTMLElement[]) el.classList.toggle('on', el.dataset.id === id);
}

let pop = 8_182_004_117;
export function setLive(text: string, solo: boolean) {
  const el = $('live');
  el.textContent = text;
  el.classList.toggle('solo', solo);
}

export function tickPopulation() {
  pop -= Math.floor(Math.random() * 40);
  $('menu-pop').textContent = `${fmt(pop)} humans on the menu`;
}

// ---------- HUD ----------

export class Hud {
  private feed = $('feed');
  private toasts = $('toasts');
  private board = $('board');
  private score = $('score');
  private combo = $('combo');
  private mini = $<HTMLCanvasElement>('minimap');
  private mctx = this.mini.getContext('2d')!;
  private lastScore = 0;
  private comboN = 0;
  private comboAt = 0;
  private lastRank = 99;
  private boardTimer = 0;
  private miniTimer = 0;

  reset() {
    this.feed.innerHTML = '';
    this.toasts.innerHTML = '';
    this.comboN = 0;
    this.lastRank = 99;
    this.lastScore = 0;
    this.combo.classList.remove('on');
  }

  killFeed(killer: Snake | null, victim: Snake, player: Snake | null) {
    const el = document.createElement('div');
    const c = killer ? killer.brand.glow : '#FF2D55';
    el.style.setProperty('--c', c);
    const name = (s: Snake) => `<b style="color:${s.brand.glow}">${esc(s === player ? 'You' : s.name)}</b>`;
    // Jev ne parle pas : il décide, avec une probabilité.
    const verb = killer?.brand.id === 'jev' ? `<em>decided (p=${(0.9 + Math.random() * 0.099).toFixed(3)}) to cut off</em>` : '<em>cut off</em>';
    el.innerHTML = killer
      ? `${name(killer)} ${verb} ${name(victim)}`
      : `${name(victim)} <em>hit</em> the wall`;
    this.feed.prepend(el);
    while (this.feed.children.length > 5) this.feed.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4600);
  }

  toast(logo: number) {
    const v = VICTIMS[logo];
    this.pushToast(`<img src="${logoUrl(v.id)}" alt=""><div><div class="t1"><s>${esc(v.name)}</s> eaten</div><div class="t2">${esc(v.epitaph)}</div></div>`);
  }

  bigToast(title: string, sub = '') {
    this.pushToast(`<div><div class="t1">${esc(title)}</div>${sub ? `<div class="t2">${esc(sub)}</div>` : ''}</div>`, true);
  }

  private pushToast(html: string, big = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (big ? ' big' : '');
    el.innerHTML = html;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), big ? 2600 : 2200);
    setTimeout(() => el.remove(), big ? 3000 : 2600);
  }

  bumpCombo(now: number): number {
    this.comboN = now - this.comboAt < 1.1 ? this.comboN + 1 : 1;
    this.comboAt = now;
    if (this.comboN >= 5) {
      this.combo.classList.add('on');
      const b = this.combo.querySelector('b')!;
      b.textContent = 'x' + this.comboN;
      this.combo.classList.remove('bump');
      void this.combo.offsetWidth;
      this.combo.classList.add('bump');
    }
    return this.comboN;
  }

  update(world: ArenaView, dt: number) {
    const p = world.player;
    if (!p) return;
    if (world.time - this.comboAt > 1.1) this.combo.classList.remove('on');

    const sc = p.score;
    if (sc !== this.lastScore) {
      this.score.textContent = fmt(sc);
      if (sc - this.lastScore >= 50) {
        this.score.classList.remove('bump');
        void this.score.offsetWidth;
        this.score.classList.add('bump');
      }
      this.lastScore = sc;
    }
    $('st-humans').textContent = fmt(p.humans);
    $('st-logos').textContent = String(p.logos.length);
    $('st-kills').textContent = String(p.kills);

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.25;
      this.renderBoard(world, p);
    }
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.1;
      this.renderMinimap(world, p);
    }
  }

  private renderBoard(world: ArenaView, p: Snake) {
    const alive = world.ranking();
    const rank = alive.indexOf(p) + 1;
    const top = matchMedia('(max-width: 720px)').matches ? 5 : 10;
    let html = '';
    alive.slice(0, top).forEach((s, i) => {
      html += `<li class="${s === p ? 'me' : ''}" style="--c:${s.brand.glow}"><span class="r">${i + 1}</span><i></i><span class="n">${esc(s.name)}</span><span class="s">${fmt(s.score)}</span></li>`;
    });
    if (rank > top && p.alive) {
      html += `<li class="sep"></li><li class="me" style="--c:${p.brand.glow}"><span class="r">${rank}</span><i></i><span class="n">${esc(p.name)}</span><span class="s">${fmt(p.score)}</span></li>`;
    }
    this.board.innerHTML = html;
    $('alive-count').textContent = `${alive.length} AIs`;
    if (p.alive) {
      $('st-rank').textContent = String(rank);
      if (rank === 1 && this.lastRank !== 1 && world.time - p.bornAt > 3) {
        this.bigToast('#1 MARKET LEADER', 'Every AI is coming for you.');
        popFace(faceFor(p.brand.id), pickShout('top'), true);
      }
      else if (rank <= 3 && this.lastRank > 3 && world.time - p.bornAt > 3) this.bigToast('TOP 3', 'Investors are watching.');
      this.lastRank = rank;
    }
  }

  private renderMinimap(world: ArenaView, p: Snake) {
    const g = this.mctx;
    const S = this.mini.width;
    const k = (S / 2 - 8) / WORLD_R;
    g.clearRect(0, 0, S, S);
    g.save();
    g.translate(S / 2, S / 2);
    g.strokeStyle = 'rgba(255,60,100,0.6)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, WORLD_R * k, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (const f of [0.33, 0.66]) {
      g.beginPath();
      g.arc(0, 0, WORLD_R * k * f, 0, Math.PI * 2);
      g.stroke();
    }
    for (const s of world.ranking()) {
      if (s === p) continue;
      const sz = 2 + Math.min(6, s.r / 8);
      g.fillStyle = s.brand.glow;
      g.globalAlpha = 0.75;
      g.beginPath();
      g.arc(s.x * k, s.y * k, sz, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (p.alive) {
      g.strokeStyle = p.brand.glow;
      g.lineWidth = 3;
      g.beginPath();
      for (let j = 0; j < p.xs.length; j += 6) {
        if (j) g.lineTo(p.xs[j] * k, p.ys[j] * k);
        else g.moveTo(p.xs[j] * k, p.ys[j] * k);
      }
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(p.x * k, p.y * k, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  joystick(j: { active: boolean; x: number; y: number; dx: number; dy: number }) {
    const el = $('joy');
    el.classList.toggle('hidden', !j.active);
    if (!j.active) return;
    el.style.left = j.x + 'px';
    el.style.top = j.y + 'px';
    (el.firstElementChild as HTMLElement).style.transform = `translate(${j.dx}px, ${j.dy}px)`;
  }
}

// ---------- Écran de mort ----------

export function showDeath(p: Snake, world: ArenaView, bestRank: number) {
  const killer = p.killedBy;
  $('death-kicker').textContent = killer ? `ACQUIRED BY ${killer.brand.maker.toUpperCase()}` : 'OUT OF BOUNDS';
  $('death-title').innerHTML = killer ? `CUT OFF BY<br><span>${esc(killer.name.toUpperCase())}</span>` : `YOU HIT<br><span>THE WALL</span>`;
  const secs = Math.round(world.time - p.bornAt);
  const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`;
  const lines = [
    `${fmt(p.humans)} human${p.humans === 1 ? '' : 's'} replaced in ${time}.`,
    p.logos.length ? `${p.logos.length} startup${p.logos.length === 1 ? '' : 's'} absorbed into your portfolio.` : 'No startups acquired. Your VCs are disappointed.',
  ];
  $('death-sub').textContent = lines.join(' ');
  const stats: [string, string][] = [
    [fmt(Math.round(p.peak * 10)), 'max length'],
    [fmt(p.humans), 'humans'],
    [String(p.logos.length), 'startups'],
    [String(p.kills), 'kills'],
    [bestRank < 99 ? '#' + bestRank : '-', 'best rank'],
    [time, 'survived'],
  ];
  $('death-stats').innerHTML = stats.map(([v, l], i) => `<div style="animation-delay:${0.1 + i * 0.05}s"><b>${v}</b><span>${l}</span></div>`).join('');

  const counts = new Map<number, number>();
  for (const l of p.logos) counts.set(l, (counts.get(l) ?? 0) + 1);
  const pf = $('portfolio');
  pf.innerHTML = counts.size
    ? [...counts.entries()]
        .map(([l, n], i) => `<div title="${esc(VICTIMS[l].name)}" style="animation-delay:${0.3 + i * 0.03}s"><img src="${logoUrl(VICTIMS[l].id)}" alt="${esc(VICTIMS[l].name)}">${n > 1 ? `<b>x${n}</b>` : ''}</div>`)
        .join('')
    : '<p>Empty. Eat the app icons to acquire startups.</p>';
  $('portfolio-count').textContent = `${counts.size} / ${VICTIMS.length}`;
}
