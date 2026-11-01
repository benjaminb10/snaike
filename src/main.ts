import './style.css';
import { sfx } from './audio';
import { BRANDS, brandById, type Brand } from './data/brands';
import { HUMAN, LOGO, World, type ArenaView, type Snake } from './game/world';
import { NetWorld } from './net/networld';
import { Input } from './input';
import { Renderer } from './render/renderer';
import { loadLogos } from './render/sprites';
import { billboardSeen, buildSponsorRail, currentBillboard, fillDeathSponsor, loadSponsors, menuShown, newLife } from './sponsors';
import { faceFor, pickShout, pop, randomFace, resetPop } from './pop';
import { Hud, buildMenu, loaderProgress, markPicked, setBrandColor, setLive, showDeath, tickPopulation } from './ui';

type State = 'menu' | 'play' | 'dead';

const $ = (id: string) => document.getElementById(id)!;
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* stockage indisponible : tant pis */
    }
  },
};

async function boot() {
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  // Connexion au serveur en parallèle du chargement ; sans serveur, on joue en solo.
  const forceSolo = new URLSearchParams(location.search).has('solo');
  const netP = forceSolo ? Promise.resolve(null) : NetWorld.connect().catch(() => null);
  const [net0] = await Promise.all([netP, loadLogos(loaderProgress), document.fonts?.ready, loadSponsors()]);

  const renderer = new Renderer($('game') as HTMLCanvasElement);
  const input = new Input($('game'), $('boost-btn'));
  const hud = new Hud();
  let world: ArenaView = net0 ?? new World();
  let state: State = 'menu';
  let brand: Brand = brandById(store.get('brand') ?? 'claude');
  let deadAt = 0;
  let slowmo = 0;
  let bestRank = 99;
  let attract: Snake | null = null;

  const nick = $('nick') as HTMLInputElement;
  nick.value = store.get('nick') ?? '';

  const pick = (b: Brand) => {
    brand = b;
    store.set('brand', b.id);
    setBrandColor(b);
    markPicked(b.id);
    sfx.unlock();
    sfx.click();
  };
  buildMenu(brand.id, pick);
  buildSponsorRail($('sp-rail'));
  setBrandColor(brand);

  const show = (s: State) => {
    state = s;
    $('menu').classList.toggle('hidden', s !== 'menu');
    $('hud').classList.toggle('hidden', s === 'menu');
    $('death').classList.add('hidden');
    document.body.classList.toggle('playing', s === 'play');
    renderer.menuMode = s === 'menu';
    if (s === 'menu') menuShown();
  };

  const started = (p: Snake) => {
    newLife();
    input.angle = p.angle;
    renderer.snapTo(p.x, p.y);
    hud.reset();
    resetPop();
    bestRank = 99;
    slowmo = 0;
    show('play');
    $('game').focus();
  };

  const play = () => {
    sfx.unlock();
    sfx.start();
    store.set('nick', nick.value.trim());
    if (world instanceof NetWorld) {
      world.onSpawn = started;
      world.join(nick.value.trim(), brand);
    } else if (world instanceof World) {
      world.player = null;
      started(world.spawnPlayer(nick.value.trim(), brand));
    }
  };

  // En ligne : statut dans le menu, et repli en solo si le serveur coupe.
  const liveLabel = () => {
    if (world instanceof NetWorld) {
      const n = world.online;
      setLive(`● LIVE · ${n || 1} ${n > 1 ? 'PLAYERS' : 'PLAYER'} ONLINE`, false);
    } else setLive('● SOLO ARENA', true);
  };
  const watchNet = (w: ArenaView) => {
    if (!(w instanceof NetWorld)) return;
    w.onClose = () => {
      world = new World();
      attract = null;
      liveLabel();
      if (state !== 'menu') {
        show('menu');
        hud.bigToast('CONNECTION LOST', 'Switched to the solo arena.');
      }
    };
  };
  renderer.onBillboard = (b) => state === 'play' && billboardSeen(b);
  watchNet(world);
  liveLabel();
  setInterval(liveLabel, 1000);

  $('play-form').addEventListener('submit', (e) => {
    e.preventDefault();
    play();
  });
  $('btn-again').addEventListener('click', play);
  $('btn-menu').addEventListener('click', () => {
    sfx.click();
    world.player = null;
    show('menu');
  });
  addEventListener('keydown', (e) => {
    if (state === 'menu' && document.activeElement !== nick) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= BRANDS.length) pick(BRANDS[n - 1]);
      if (e.key === 'Enter') play();
    } else if (state === 'dead' && e.key === 'Enter' && !$('death').classList.contains('hidden')) play();
  });

  const muteBtn = $('mute');
  const setMute = (m: boolean) => {
    sfx.setMuted(m);
    muteBtn.textContent = m ? 'SOUND OFF' : 'SOUND ON';
    store.set('muted', m ? '1' : '0');
  };
  setMute(store.get('muted') === '1');
  muteBtn.addEventListener('click', () => {
    sfx.unlock();
    setMute(!sfx.muted);
  });
  input.onFirstInput = () => sfx.unlock();

  setInterval(() => state === 'menu' && tickPopulation(), 120);

  // ---------- Boucle ----------
  let last = performance.now();
  const frame = (now: number) => {
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    input.update();
    const p = world.player;

    // Ralenti à la mort du joueur.
    slowmo = Math.max(0, slowmo - real);
    const scale = slowmo > 0 ? 0.25 : 1;
    const dt = real * scale;

    if (state === 'play' && p && p.alive) {
      p.wantAngle = input.angle;
      p.wantBoost = input.boost;
    }
    const steps = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < steps; i++) world.step(dt / steps);

    // Événements → son, interface, effets.
    for (const e of world.events) {
      if (e.type === 'eat' && e.snake === p) {
        if (e.food.kind === HUMAN) {
          sfx.eatHuman();
          if (hud.bumpCombo(world.time) === 40) pop(faceFor('deepseek'), pickShout('combo'));
        } else if (e.food.kind === LOGO) {
          sfx.eatLogo();
          hud.toast(e.food.logo);
          if (p.logos.length % 4 === 0) pop(randomFace(), pickShout('logo'));
          if (p.logos.length === 1) setTimeout(() => hud.bigToast('FIRST ACQUISITION', 'Your startup portfolio is open for business.'), 600);
        } else {
          sfx.eatOrb();
          hud.bumpCombo(world.time);
        }
      } else if (e.type === 'death') {
        if (state !== 'menu') hud.killFeed(e.killer, e.snake, p);
        if (e.snake === p) {
          sfx.death();
          sfx.setBoost(false);
          slowmo = 0.7;
          deadAt = now;
          state = 'dead';
          document.body.classList.remove('playing');
          if (e.killer) pop(faceFor(e.killer.brand.id), pickShout('death'), true);
        } else if (e.killer === p) {
          sfx.kill();
          pop(faceFor(p!.brand.id), pickShout('kill'), true);
        }
      }
    }
    renderer.handleEvents(world.events, world);
    world.events.length = 0;

    // Caméra
    if (state === 'menu') {
      if (!attract || !attract.alive || Math.random() < 0.001) {
        const alive = world.snakes.filter((s) => s.alive);
        attract = alive.sort((a, b) => b.mass - a.mass)[Math.floor(Math.random() * Math.min(4, alive.length))] ?? null;
      }
      if (attract) renderer.follow(attract.x, attract.y, attract.r, false, real);
    } else if (p) {
      renderer.follow(p.x, p.y, p.r, p.alive && p.boosting, real);
    }

    if (state === 'play' && p) {
      sfx.setBoost(p.boosting);
      renderer.boostLines += ((p.boosting ? 1 : 0) - renderer.boostLines) * Math.min(1, real * 8);
      hud.update(world, real);
      const rank = world.ranking().filter((s) => s !== p && s.mass > p.mass).length + 1;
      bestRank = Math.min(bestRank, rank);
    } else {
      renderer.boostLines *= 0.9;
    }
    if (state !== 'menu') hud.joystick(input.joystick);

    if (state === 'dead' && p && $('death').classList.contains('hidden') && now - deadAt > 1500) {
      showDeath(p, world, bestRank);
      fillDeathSponsor($('sp-death'));
      $('death').classList.remove('hidden');
      $('hud').classList.add('hidden');
    }

    if (world instanceof NetWorld) {
      world.view.x = renderer.cam.x;
      world.view.y = renderer.cam.y;
      world.view.hw = renderer.viewHalfW();
      world.view.hh = renderer.viewHalfH();
    }
    renderer.billboard = currentBillboard();
    renderer.render(world, dt);
    requestAnimationFrame(frame);
  };

  $('loader').classList.add('hidden');
  show('menu');
  requestAnimationFrame(frame);

  // Retour d'arrière-plan : pas de saut de temps géant.
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (document.hidden) sfx.setBoost(false);
  });
  if (import.meta.env.DEV) Object.assign(window, { game: { get world() { return world; }, renderer, input, reset: () => (world = new World()) } });
  addEventListener('pagehide', () => world instanceof NetWorld && world.close());
}

boot();
