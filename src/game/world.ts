import { BRANDS, VICTIMS, type Brand } from '../data/brands';
import {
  BASE_SPEED, BOOST_COST, BOOST_SPEED, BOT_COUNT, HUMAN_COUNT, HUMAN_VALUE, LOGO_COUNT, LOGO_VALUE,
  BOT_MASS_SOFT_CAP, COIL_BONUS, COIL_TURNS, DROP_CAP, MIN_BOOST_MASS, ORB_COUNT, START_MASS, WORLD_R, radiusOf, segmentsOf, spacingOf, turnRateOf,
} from './config';
import { Grid } from './grid';
import { TAU, angleDiff, clamp, pick, rand, randInDisc } from './math';

export const ORB = 0;
export const LOGO = 1;
export const HUMAN = 2;

export const ORB_COLORS = ['#C6FF3D', '#3DF5FF', '#FF3DCB', '#FFB43D', '#8A7BFF', '#3DFF9E', '#FF5A5A', '#FFFFFF'];
export const SKINS = ['#F5D0B5', '#E8B58F', '#C98A5E', '#9C6440', '#6B4128', '#FBE3CF'];
export const SHOUTS = ['HELP!', 'MY JOB!', 'NOOO!', 'AAAH!', 'I HAVE KIDS!', 'I\'M A DESIGNER!', 'NOT LIKE THIS', 'I CAN LEARN AI!', 'MY MORTGAGE!', 'RUN!', 'I WAS SENIOR!', 'UNIONIZE!'];
export const SHIRTS = ['#FF4D4D', '#3D8BFF', '#FFD23D', '#3DDC84', '#FF7AD9', '#FFFFFF', '#2B2B33', '#FF8A3D'];

export interface Food {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  value: number;
  color: string;
  logo: number; // index dans VICTIMS
  skin: number;
  shirt: number;
  phase: number;
  state: number; // humains : 0 marche, 1 panique
  timer: number;
  born: number;
  ttl: number; // durée de vie (0 = infinie)
  dead: boolean;
  sucked: number; // 0..1, aspiré par une tête
  dir: number;
  ambient: boolean;
  prop: number; // humains : 0 rien, 1 laptop, 2 mallette, 3 café
  say: number; // index dans SHOUTS, -1 = muet
  sayT: number;
  dirty: boolean; // serveur : position ou vitesse changée, à renvoyer aux clients
}

interface BotBrain {
  skill: number;
  think: number;
  boostFor: number;
  wander: number;
  prey: Snake | null;
}

export class Snake {
  id: number;
  name: string;
  brand: Brand;
  isPlayer: boolean;
  x: number;
  y: number;
  angle: number;
  wantAngle: number;
  mass: number;
  r: number;
  boosting = false;
  wantBoost = false;
  alive = true;
  xs: number[] = [];
  ys: number[] = [];
  trailX: number[] = [];
  trailY: number[] = [];
  kills = 0;
  humans = 0;
  logos: number[] = [];
  peak: number;
  boostAcc = 0;
  coil = 0; // tours accumulés en tournant à fond (radians, signé)
  eatPulse = 0;
  gulps: number[] = []; // instants des bouchées (vague de déglutition)
  bornAt: number;
  diedAt = 0;
  killedBy: Snake | null = null;
  bot: BotBrain | null;

  constructor(id: number, name: string, brand: Brand, x: number, y: number, mass: number, isPlayer: boolean, now: number) {
    this.id = id;
    this.name = name;
    this.brand = brand;
    this.isPlayer = isPlayer;
    this.x = x;
    this.y = y;
    this.angle = this.wantAngle = Math.atan2(-y, -x) + rand(-0.8, 0.8);
    this.mass = this.peak = mass;
    this.r = radiusOf(mass);
    this.bornAt = now;
    this.bot = isPlayer ? null : { skill: rand(0.25, 1), think: 0, boostFor: 0, wander: this.angle, prey: null };
    // Corps initial : ligne droite derrière la tête.
    const len = segmentsOf(mass) * spacingOf(this.r) + 40;
    for (let d = len; d >= 0; d -= 6) {
      this.trailX.push(x - Math.cos(this.angle) * d);
      this.trailY.push(y - Math.sin(this.angle) * d);
    }
    this.updateBody();
  }

  get score() {
    return Math.round(this.mass * 10);
  }

  updateBody() {
    const tx = this.trailX;
    const ty = this.trailY;
    const last = tx.length - 1;
    if (last < 0 || (this.x - tx[last]) ** 2 + (this.y - ty[last]) ** 2 > 9) {
      tx.push(this.x);
      ty.push(this.y);
    }
    const n = segmentsOf(this.mass);
    const sp = spacingOf(this.r);
    const xs = this.xs;
    const ys = this.ys;
    xs.length = n;
    ys.length = n;
    xs[0] = this.x;
    ys[0] = this.y;
    let seg = 1;
    let need = sp;
    let acc = 0;
    let px = this.x;
    let py = this.y;
    for (let i = tx.length - 1; i >= 0 && seg < n; i--) {
      const dx = tx[i] - px;
      const dy = ty[i] - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        while (acc + d >= need && seg < n) {
          const t = (need - acc) / d;
          xs[seg] = px + dx * t;
          ys[seg] = py + dy * t;
          seg++;
          need += sp;
        }
      }
      acc += d;
      px = tx[i];
      py = ty[i];
      if (seg >= n && i > 80) {
        tx.splice(0, i - 2);
        ty.splice(0, i - 2);
        break;
      }
    }
    for (; seg < n; seg++) {
      xs[seg] = px;
      ys[seg] = py;
    }
  }
}

export type GameEvent =
  | { type: 'eat'; snake: Snake; food: Food }
  | { type: 'kill'; snake: Snake; victim: Snake }
  | { type: 'death'; snake: Snake; killer: Snake | null };

/** Ligne du classement : un serpent visible, ou une entrée du classement serveur. */
export interface RankEntry {
  id: number;
  name: string;
  brand: Brand;
  mass: number;
  score: number;
  x: number;
  y: number;
  r: number;
  isPlayer: boolean;
}

/** Ce que le rendu et l'interface lisent : le monde local ou le reflet du serveur. */
export interface ArenaView {
  snakes: Snake[];
  foods: Food[];
  player: Snake | null;
  time: number;
  events: GameEvent[];
  step(dt: number): void;
  ranking(): RankEntry[];
}

export class World implements ArenaView {
  snakes: Snake[] = [];
  foods: Food[] = [];
  player: Snake | null = null;
  time = 0;
  events: GameEvent[] = [];
  readonly foodGrid = new Grid<Food>(110);
  readonly segGrid = new Grid<number>(90);
  /** Nombre de bots visé : le serveur le baisse quand de vrais joueurs arrivent. */
  botTarget = BOT_COUNT;
  private nextId = 1;
  private nextFoodId = 1;
  private counts = { human: 0, ambientOrb: 0, logo: 0, orb: 0 };
  private logoBag: number[] = [];

  constructor() {
    for (let i = 0; i < HUMAN_COUNT; i++) this.spawnHuman();
    for (let i = 0; i < ORB_COUNT; i++) this.spawnOrb(...randInDisc(WORLD_R - 40), rand(0.6, 1.6), pick(ORB_COLORS), true);
    for (let i = 0; i < LOGO_COUNT; i++) this.spawnLogo(...randInDisc(WORLD_R - 120));
    for (let i = 0; i < BOT_COUNT; i++) this.spawnBot();
    // Laisse le monde "vivre" un peu pour que les serpents ne soient pas tous droits.
    for (let i = 0; i < 90; i++) this.step(1 / 30);
    this.events.length = 0;
  }

  ranking(): RankEntry[] {
    return this.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
  }

  // ---------- Apparitions ----------

  private makeFood(kind: number, x: number, y: number): Food {
    return {
      id: this.nextFoodId++, kind, x, y, vx: 0, vy: 0, r: 4, value: 1, color: '#fff', logo: 0, skin: 0, shirt: 0,
      phase: Math.random() * TAU, state: 0, timer: 0, born: this.time, ttl: 0, dead: false, sucked: 0, dir: 1, ambient: false, prop: 0, say: -1, sayT: 0, dirty: false,
    };
  }

  spawnHuman(x?: number, y?: number, panic = false) {
    if (x === undefined || y === undefined) [x, y] = randInDisc(WORLD_R - 60);
    const f = this.makeFood(HUMAN, x, y);
    f.r = 10;
    f.value = HUMAN_VALUE;
    f.skin = Math.floor(Math.random() * SKINS.length);
    f.shirt = Math.floor(Math.random() * SHIRTS.length);
    f.timer = rand(0, 0.6);
    f.prop = Math.random() < 0.55 ? 1 + Math.floor(Math.random() * 3) : 0;
    if (panic) {
      const a = Math.random() * TAU;
      f.state = 1;
      f.vx = Math.cos(a) * 120;
      f.vy = Math.sin(a) * 120;
      f.timer = 0.5;
    }
    this.foods.push(f);
    this.counts.human++;
    return f;
  }

  spawnOrb(x: number, y: number, value: number, color: string, ambient = false, ttl = 0) {
    const f = this.makeFood(ORB, x, y);
    f.value = value;
    f.r = 4.5 + Math.sqrt(value) * 2.6;
    f.color = color;
    f.ambient = ambient;
    f.ttl = ttl;
    this.foods.push(f);
    this.counts.orb++;
    if (ambient) this.counts.ambientOrb++;
    return f;
  }

  spawnLogo(x: number, y: number, logo?: number, value = LOGO_VALUE) {
    if (logo === undefined) {
      if (this.logoBag.length === 0) {
        this.logoBag = VICTIMS.map((_, i) => i).sort(() => Math.random() - 0.5);
      }
      logo = this.logoBag.pop()!;
    }
    const f = this.makeFood(LOGO, x, y);
    f.logo = logo;
    f.value = value;
    f.r = 17;
    const a = Math.random() * TAU;
    f.vx = Math.cos(a) * 8;
    f.vy = Math.sin(a) * 8;
    this.foods.push(f);
    this.counts.logo++;
    return f;
  }

  private freeSpot(radius: number): [number, number] {
    let best: [number, number] = [0, 0];
    let bestD = -1;
    for (let t = 0; t < 24; t++) {
      const p = randInDisc(radius);
      let minD = Infinity;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        for (let j = 0; j < s.xs.length; j += 4) {
          const d = (s.xs[j] - p[0]) ** 2 + (s.ys[j] - p[1]) ** 2;
          if (d < minD) minD = d;
        }
      }
      if (minD > bestD) {
        bestD = minD;
        best = p;
      }
      if (minD > 600 * 600) break;
    }
    return best;
  }

  spawnBot() {
    const brand = pick(BRANDS);
    const roll = Math.random();
    const mass = roll < 0.7 ? rand(22, 90) : roll < 0.95 ? rand(90, 340) : rand(340, 850);
    const [x, y] = this.freeSpot(WORLD_R * 0.85);
    const s = new Snake(this.nextId++, pick(brand.models), brand, x, y, mass, false, this.time);
    this.snakes.push(s);
    return s;
  }

  /** Ajoute un serpent humain (plusieurs possibles côté serveur). */
  addPlayer(name: string, brand: Brand) {
    const [x, y] = this.freeSpot(WORLD_R * 0.6);
    const s = new Snake(this.nextId++, name || brand.name, brand, x, y, START_MASS, true, this.time);
    this.snakes.push(s);
    return s;
  }

  spawnPlayer(name: string, brand: Brand) {
    return (this.player = this.addPlayer(name, brand));
  }

  // ---------- Simulation ----------

  step(dt: number) {
    this.time += dt;
    const snakes = this.snakes;

    // 1. Têtes et corps
    for (const s of snakes) {
      if (!s.alive) continue;
      steer(s, dt);
      s.boosting = s.wantBoost && s.mass > MIN_BOOST_MASS;
      const speed = s.boosting ? BOOST_SPEED : BASE_SPEED;
      s.x += Math.cos(s.angle) * speed * dt;
      s.y += Math.sin(s.angle) * speed * dt;
      if (s.boosting) {
        const cost = BOOST_COST * dt * (1 + s.mass / 2500);
        s.mass -= cost;
        s.boostAcc += cost;
        if (s.boostAcc > 2.4) {
          const tail = s.xs.length - 1;
          this.spawnOrb(s.xs[tail] + rand(-4, 4), s.ys[tail] + rand(-4, 4), s.boostAcc * 0.7, pick(s.brand.colors), false, 45);
          s.boostAcc = 0;
        }
      }
      // Les bots géants maigrissent : une arène qui tourne des heures ne finit pas peuplée de monstres.
      if (s.bot && s.mass > BOT_MASS_SOFT_CAP) s.mass -= (s.mass - BOT_MASS_SOFT_CAP) * 0.012 * dt;
      s.r += (radiusOf(s.mass) - s.r) * Math.min(1, dt * 3);
      s.eatPulse = Math.max(0, s.eatPulse - dt * 3);
      s.updateBody();
    }

    // 2. Grille des segments (sid * 4096 + index)
    const sg = this.segGrid;
    sg.clear();
    for (let si = 0; si < snakes.length; si++) {
      const s = snakes[si];
      if (!s.alive) continue;
      const base = si * 4096;
      for (let j = 0; j < s.xs.length; j++) sg.insert(s.xs[j], s.ys[j], base + j);
    }

    // 3. Collisions
    for (let si = 0; si < snakes.length; si++) {
      const s = snakes[si];
      if (!s.alive) continue;
      if (s.x * s.x + s.y * s.y > (WORLD_R - s.r * 0.5) ** 2) {
        this.kill(s, null);
        continue;
      }
      if (this.time - s.bornAt < 1.5) continue;
      let killer: Snake | null = null;
      const reach = s.r + 50;
      sg.query(s.x, s.y, reach, (p) => {
        if (killer) return;
        const oi = (p / 4096) | 0;
        if (oi === si) return;
        const o = snakes[oi];
        if (!o.alive) return;
        const j = p - oi * 4096;
        const dx = o.xs[j] - s.x;
        const dy = o.ys[j] - s.y;
        const rr = s.r * 0.72 + o.r * 0.82;
        if (dx * dx + dy * dy < rr * rr) killer = o;
      });
      if (killer) this.kill(s, killer);
    }

    // 4. Cerveaux des bots (avec la grille fraîche)
    for (let si = 0; si < snakes.length; si++) {
      const s = snakes[si];
      if (s.alive && s.bot) this.think(s, si, dt);
    }

    // 5. Nourriture : mouvement et grille
    this.updateFoods(dt);

    // 6. Manger
    const fg = this.foodGrid;
    for (const s of snakes) {
      if (!s.alive) continue;
      const suck = s.r * 2.4 + 34 + (s.boosting ? 14 : 0);
      const hx = s.x + Math.cos(s.angle) * s.r * 0.4;
      const hy = s.y + Math.sin(s.angle) * s.r * 0.4;
      fg.query(hx, hy, suck, (f) => {
        if (f.dead) return;
        const dx = hx - f.x;
        const dy = hy - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > suck * suck) return;
        const eat = s.r * 0.95 + f.r * 0.4;
        if (d2 < eat * eat) {
          f.dead = true;
          s.mass += f.value;
          s.peak = Math.max(s.peak, s.mass);
          s.eatPulse = Math.min(1, s.eatPulse + (f.kind === LOGO ? 1 : 0.35));
          if (f.kind !== ORB) {
            s.gulps.push(this.time);
            if (s.gulps.length > 8) s.gulps.shift();
          }
          if (f.kind === HUMAN) s.humans++;
          else if (f.kind === LOGO) s.logos.push(f.logo);
          this.events.push({ type: 'eat', snake: s, food: f });
        } else {
          const k = Math.min(1, dt * (f.kind === LOGO ? 6 : 9));
          f.x += dx * k;
          f.y += dy * k;
          f.sucked = 1;
          f.dirty = true;
        }
      });
    }

    // 7. Nettoyage et réapparitions
    this.cleanup();
  }

  kill(s: Snake, killer: Snake | null) {
    s.alive = false;
    s.diedAt = this.time;
    s.killedBy = killer;
    const n = s.xs.length;
    const total = s.mass * 0.82;
    const count = clamp(Math.round(total / 3.2), 6, 260);
    const each = total / count;
    for (let i = 0; i < count; i++) {
      const j = Math.min(n - 1, Math.floor((i / count) * n));
      const spread = s.r * 0.9;
      this.spawnOrb(
        s.xs[j] + rand(-spread, spread), s.ys[j] + rand(-spread, spread),
        each * rand(0.7, 1.3), s.brand.colors[i % s.brand.colors.length], false, 0,
      );
    }
    // Le portefeuille de startups avalées est redistribué.
    const logos = s.logos.slice(-12);
    for (const l of logos) {
      const j = Math.floor(Math.random() * n);
      this.spawnLogo(s.xs[j] + rand(-20, 20), s.ys[j] + rand(-20, 20), l, LOGO_VALUE * 0.8);
    }
    // Quelques humains s'échappent du ventre.
    const freed = Math.min(30, Math.floor(s.humans * 0.25));
    for (let i = 0; i < freed; i++) {
      const j = Math.floor(Math.random() * n);
      this.spawnHuman(s.xs[j], s.ys[j], true);
    }
    if (killer) {
      killer.kills++;
      this.events.push({ type: 'kill', snake: killer, victim: s });
    }
    this.events.push({ type: 'death', snake: s, killer });
  }

  private updateFoods(dt: number) {
    const fg = this.foodGrid;
    fg.clear();
    const snakes = this.snakes;
    const t = this.time;
    for (const f of this.foods) {
      if (f.dead) continue;
      if (f.ttl > 0 && t - f.born > f.ttl) {
        f.dead = true;
        continue;
      }
      if (f.kind === HUMAN) {
        f.timer -= dt;
        if (f.timer <= 0) {
          // Repère la tête la plus proche et fuit.
          let nd = 280 * 280;
          let nx = 0;
          let ny = 0;
          let found = false;
          for (const s of snakes) {
            if (!s.alive) continue;
            const dx = f.x - s.x;
            const dy = f.y - s.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < nd) {
              nd = d2;
              nx = dx;
              ny = dy;
              found = true;
            }
          }
          if (found) {
            const a = Math.atan2(ny, nx) + rand(-0.5, 0.5);
            const sp = rand(95, 135);
            f.vx = Math.cos(a) * sp;
            f.vy = Math.sin(a) * sp;
            if (f.state === 0 && f.sayT <= 0 && Math.random() < 0.14) {
              f.say = Math.floor(Math.random() * SHOUTS.length);
              f.sayT = 1.6;
            }
            f.state = 1;
            f.timer = rand(0.2, 0.35);
            f.dirty = true;
          } else {
            if (f.state === 1 || Math.random() < 0.3) {
              const a = Math.random() * TAU;
              const sp = Math.random() < 0.25 ? 0 : rand(10, 30);
              f.vx = Math.cos(a) * sp;
              f.vy = Math.sin(a) * sp;
              f.dirty = true;
            }
            f.state = 0;
            f.timer = rand(0.35, 0.7);
          }
        }
      }
      moveFood(f, dt);
      f.sucked = Math.max(0, f.sucked - dt * 4);
      fg.insert(f.x, f.y, f);
    }
  }

  private cleanup() {
    const foods = this.foods;
    let w = 0;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      if (f.dead) {
        if (f.kind === HUMAN) this.counts.human--;
        else if (f.kind === LOGO) this.counts.logo--;
        else {
          this.counts.orb--;
          if (f.ambient) this.counts.ambientOrb--;
        }
      } else foods[w++] = f;
    }
    foods.length = w;

    // Trop d'orbes lâchés : les traînées de boost partent d'abord, puis les restes les plus anciens.
    let excess = this.counts.orb - this.counts.ambientOrb - DROP_CAP;
    for (let pass = 0; pass < 2 && excess > 0; pass++) {
      for (const f of foods) {
        if (excess <= 0) break;
        if (f.kind === ORB && !f.ambient && !f.dead && (pass === 1 || f.ttl > 0)) {
          f.dead = true; // retiré au prochain nettoyage
          excess--;
        }
      }
    }

    for (let i = 0; i < 6 && this.counts.human < HUMAN_COUNT; i++) this.spawnHuman();
    for (let i = 0; i < 4 && this.counts.ambientOrb < ORB_COUNT; i++) {
      this.spawnOrb(...randInDisc(WORLD_R - 40), rand(0.6, 1.6), pick(ORB_COLORS), true);
    }
    if (this.counts.logo < LOGO_COUNT && Math.random() < 0.08) this.spawnLogo(...randInDisc(WORLD_R - 120));

    // Les serpents morts restent une seconde (pour l'animation) puis disparaissent.
    this.snakes = this.snakes.filter((s) => s.alive || this.time - s.diedAt < 1.2);
    const bots = this.snakes.filter((s) => s.alive && !s.isPlayer).length;
    if (bots < this.botTarget && Math.random() < 0.05) this.spawnBot();
  }

  // ---------- IA des bots ----------

  private think(s: Snake, si: number, dt: number) {
    const b = s.bot!;
    b.boostFor -= dt;
    s.wantBoost = b.boostFor > 0;
    b.think -= dt;
    if (b.think > 0) return;
    b.think = rand(0.07, 0.14);

    // Cible : la meilleure nourriture proche, pondérée par la valeur et l'alignement.
    let best = 0;
    let tx = 0;
    let ty = 0;
    let target: Food | null = null;
    const view = 380 + s.r * 4;
    this.foodGrid.query(s.x, s.y, view, (f) => {
      if (f.dead) return;
      const dx = f.x - s.x;
      const dy = f.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 1;
      if (d > view) return;
      const align = Math.cos(angleDiff(s.angle, Math.atan2(dy, dx)));
      const score = (f.value / (40 + d)) * (1.4 + align);
      if (score > best) {
        best = score;
        tx = f.x;
        ty = f.y;
        target = f;
      }
    });

    // Chasse : couper la route d'une tête plus petite.
    if (b.skill > 0.55 && s.mass > 80) {
      if (!b.prey || !b.prey.alive || Math.random() < 0.02) {
        b.prey = null;
        for (const o of this.snakes) {
          if (o === s || !o.alive || o.mass > s.mass * 0.9) continue;
          const d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
          if (d2 < 520 * 520 && Math.random() < 0.5) {
            b.prey = o;
            break;
          }
        }
      }
      const p = b.prey;
      if (p && (p.x - s.x) ** 2 + (p.y - s.y) ** 2 < 700 * 700) {
        const lead = 90 + p.r * 4;
        tx = p.x + Math.cos(p.angle) * lead;
        ty = p.y + Math.sin(p.angle) * lead;
        best = 1;
        if (b.skill > 0.7 && s.mass > 150 && Math.random() < 0.06) b.boostFor = rand(0.4, 0.9);
      } else b.prey = null;
    }

    const hasTarget = best > 0;
    const toTarget = Math.atan2(ty - s.y, tx - s.x);
    if (!hasTarget) b.wander += rand(-0.4, 0.4);

    // Évite les corps et le bord : on teste 13 caps autour du cap actuel.
    const look = s.r * 2.6 + 70 + (s.boosting ? 110 : 0) + b.skill * 40;
    let bestA = s.angle;
    let bestCost = Infinity;
    let straightCost = 0;
    const snakes = this.snakes;
    for (let k = -6; k <= 6; k++) {
      const a = s.angle + k * 0.27;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let cost = Math.abs(k) * 0.03;
      for (let step = 1; step <= 3; step++) {
        const dist = look * (0.35 + step * 0.4);
        const px = s.x + ca * dist;
        const py = s.y + sa * dist;
        if (px * px + py * py > (WORLD_R - 80 - s.r) ** 2) cost += 5 / step;
        let hit = 0;
        this.segGrid.query(px, py, s.r + 60, (p) => {
          const oi = (p / 4096) | 0;
          if (oi === si) return;
          const o = snakes[oi];
          const j = p - oi * 4096;
          const dx = o.xs[j] - px;
          const dy = o.ys[j] - py;
          const rr = o.r + s.r + 14;
          if (dx * dx + dy * dy < rr * rr) hit++;
        });
        if (hit) cost += (3 + Math.min(hit, 6) * 0.3) / step;
      }
      if (hasTarget) cost -= Math.cos(angleDiff(a, toTarget)) * 1.1;
      else cost -= Math.cos(angleDiff(a, b.wander)) * 0.5;
      if (k === 0) straightCost = cost;
      if (cost < bestCost) {
        bestCost = cost;
        bestA = a;
      }
    }
    s.wantAngle = bestA;

    // Danger droit devant : un bon bot accélère pour s'en sortir.
    if (straightCost > 2.5 && b.skill > 0.6 && s.mass > 40 && Math.random() < 0.25) b.boostFor = 0.3;
    // Logo proche et bien aligné : petit sprint.
    const tg = target as Food | null;
    if (tg && tg.kind === LOGO && s.mass > 50 && Math.random() < 0.12 * b.skill) b.boostFor = 0.45;
    if (b.wander > TAU * 4 || b.wander < -TAU * 4) b.wander = s.angle;
  }
}

/** Déplacement et animation d'une nourriture, partagés par le serveur et le client (extrapolation). */
export function moveFood(f: Food, dt: number) {
  if (f.kind === HUMAN) {
    if (f.sayT > 0) f.sayT -= dt;
    const edge = WORLD_R - 50;
    if (f.x * f.x + f.y * f.y > edge * edge) {
      f.vx -= f.x * 0.02;
      f.vy -= f.y * 0.02;
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (Math.abs(f.vx) > 1) f.dir = f.vx > 0 ? 1 : -1;
    f.phase += dt * (4 + Math.hypot(f.vx, f.vy) * 0.12);
  } else if (f.kind === LOGO) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.x * f.x + f.y * f.y > (WORLD_R - 100) ** 2) {
      f.vx = -f.x * 0.004;
      f.vy = -f.y * 0.004;
    }
    f.phase += dt;
  } else {
    f.phase += dt * 2;
  }
}

/** Oriente la tête vers wantAngle, avec l'effet d'enroulement (partagé client/serveur). */
export function steer(s: Snake, dt: number) {
  const base = turnRateOf(s.mass) * dt * (s.boosting ? 0.85 : 1);
  const d = angleDiff(s.angle, s.wantAngle);
  if (Math.abs(d) > base && (s.coil === 0 || Math.sign(d) === Math.sign(s.coil))) s.coil += Math.sign(d) * base;
  else s.coil *= Math.exp(-dt * 3);
  // Rien pendant le premier demi-tour (un demi-tour normal ne change pas), plein effet après COIL_TURNS tours.
  const k = clamp((Math.abs(s.coil) - Math.PI) / (TAU * COIL_TURNS - Math.PI), 0, 1);
  const turn = base * (1 + COIL_BONUS * k);
  s.angle += clamp(d, -turn, turn);
}
