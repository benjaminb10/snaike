// Une arène multijoueur : une World complète, ses clients, et l'envoi des ticks.
// Indépendante du transport : sert au serveur Node (ws) comme au Durable Object Cloudflare.
import { brandById } from '../src/data/brands';
import { BOT_COUNT } from '../src/game/config';
import { HUMAN, LOGO, ORB, World, type Food, type Snake } from '../src/game/world';
import {
  PROTOCOL, SUBSTEPS, TICK_RATE, TickWriter, brandIndex, cleanName, colorIndex, decodeInput,
  type ClientJson, type FoodAdd, type FoodUpd, type ServerJson, type SnakeIntro, type SnakeState, type Tick,
} from '../src/net/protocol';

export const ROOM_CAP = 40; // connexions par arène (spectateurs compris)
const ARENA_SNAKES = BOT_COUNT + 4; // serpents visés par arène, humains + bots
const MIN_BOTS = 8;
const MAX_VIEW = 3200; // demi-champ maximal accepté d'un client
const ADD_MARGIN = 250;
const DROP_MARGIN = 700;
const MAX_MSGS = 120; // messages par seconde et par client au-delà desquels on ignore

/** Ce dont l'arène a besoin d'une connexion, quel que soit le serveur. */
export interface Sock {
  send(data: string | Uint8Array): void;
  /** Faux si la connexion est fermée ou trop en retard (on saute alors le tick). */
  ready(): boolean;
}

// ---------- Client ----------

export class Client {
  snake: Snake | null = null;
  angle = 0;
  boost = false;
  cx = 0;
  cy = 0;
  hw = 1000;
  hh = 700;
  knownSnakes = new Set<Snake>();
  knownFoods = new Set<Food>();
  msgs = 0;
  // Tampons du tick, réutilisés.
  t: Tick = { time: 0, me: 0, kills: 0, humans: 0, snakes: [], gone: [], adds: [], upds: [], rems: [] };

  constructor(readonly sock: Sock) {}

  send(m: ServerJson | string) {
    if (this.sock.ready()) this.sock.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
}

// ---------- Arène ----------

const writer = new TickWriter();

export class Room {
  world = new World();
  clients = new Set<Client>();
  ticks = 0;
  emptySince = Date.now();

  constructor(readonly id: number) {}

  get players() {
    let n = 0;
    for (const c of this.clients) if (c.snake?.alive) n++;
    return n;
  }

  get full() {
    return this.clients.size >= ROOM_CAP;
  }

  connect(sock: Sock): Client {
    const c = new Client(sock);
    this.clients.add(c);
    c.send({ t: 'hello', v: PROTOCOL, room: this.id });
    return c;
  }

  /** Message reçu d'un client : binaire = commandes, texte = JSON. */
  message(c: Client, data: string | ArrayBuffer | ArrayBufferView) {
    if (++c.msgs > MAX_MSGS) return;
    if (typeof data !== 'string') {
      const view = ArrayBuffer.isView(data) ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
      const m = decodeInput(view);
      if (!m) return;
      c.angle = m.angle;
      c.boost = m.boost;
      c.cx = m.cx;
      c.cy = m.cy;
      c.hw = m.hw;
      c.hh = m.hh;
      return;
    }
    try {
      const msg = JSON.parse(data) as ClientJson;
      if (msg.t === 'join') this.join(c, msg);
    } catch {
      /* message illisible : ignoré */
    }
  }

  join(c: Client, msg: ClientJson) {
    if (c.snake?.alive) return;
    const brand = brandById(String(msg.b));
    const s = this.world.addPlayer(cleanName(msg.n), brand);
    c.snake = s;
    c.angle = s.angle;
    c.boost = false;
    c.send({ t: 'you', id: s.id });
  }

  leave(c: Client) {
    if (!this.clients.delete(c)) return;
    if (c.snake?.alive) this.world.kill(c.snake, null);
    c.snake = null;
    if (this.clients.size === 0) this.emptySince = Date.now();
  }

  tick() {
    const w = this.world;
    w.botTarget = Math.max(MIN_BOTS, ARENA_SNAKES - this.players);
    for (const c of this.clients) {
      if (c.snake?.alive) {
        c.snake.wantAngle = c.angle;
        c.snake.wantBoost = c.boost;
      }
    }
    for (let i = 0; i < SUBSTEPS; i++) w.step(1 / (TICK_RATE * SUBSTEPS));
    this.ticks++;
    if (this.ticks % TICK_RATE === 0) for (const c of this.clients) c.msgs = 0;

    // Événements : morts diffusées à tous, bouchées gardées pour les retraits ciblés.
    const eaten = new Map<Food, number>();
    for (const e of w.events) {
      if (e.type === 'eat') eaten.set(e.food, e.snake.id);
      else if (e.type === 'death') {
        const s = e.snake;
        const k = e.killer;
        const msg = JSON.stringify({
          t: 'die', id: s.id, n: s.name, b: brandIndex(s.brand.id), p: s.isPlayer ? 1 : 0, x: Math.round(s.x), y: Math.round(s.y),
          k: k?.id ?? 0, kn: k?.name ?? '', kb: k ? brandIndex(k.brand.id) : 0, kp: k?.isPlayer ? 1 : 0,
        } satisfies ServerJson);
        for (const c of this.clients) {
          c.knownSnakes.delete(s);
          c.send(msg);
          if (c.snake === s) c.snake = null;
        }
      }
    }
    w.events.length = 0;

    // Bounding box des serpents, une fois pour tous les clients.
    const boxes = new Map<Snake, [number, number, number, number]>();
    for (const s of w.snakes) {
      if (!s.alive) continue;
      let x0 = s.x, x1 = s.x, y0 = s.y, y1 = s.y;
      for (let j = 0; j < s.xs.length; j += 3) {
        const x = s.xs[j], y = s.ys[j];
        if (x < x0) x0 = x; else if (x > x1) x1 = x;
        if (y < y0) y0 = y; else if (y > y1) y1 = y;
      }
      boxes.set(s, [x0 - s.r, y0 - s.r, x1 + s.r, y1 + s.r]);
    }

    for (const c of this.clients) this.sendTick(c, boxes, eaten);
    for (const f of w.foods) f.dirty = false;

    if (this.ticks % (TICK_RATE / 2) === 0) this.sendRoster();
  }

  private sendTick(c: Client, boxes: Map<Snake, [number, number, number, number]>, eaten: Map<Food, number>) {
    if (!c.sock.ready()) return; // client lent ou parti : on saute
    const w = this.world;
    const me = c.snake?.alive ? c.snake : null;
    const cx = me ? me.x : c.cx;
    const cy = me ? me.y : c.cy;
    const hw = Math.min(MAX_VIEW, c.hw);
    const hh = Math.min(MAX_VIEW, c.hh);
    const t = c.t;
    t.snakes.length = t.gone.length = t.adds.length = t.upds.length = t.rems.length = 0;
    t.time = w.time;
    t.me = me?.id ?? 0;
    t.kills = me?.kills ?? 0;
    t.humans = me?.humans ?? 0;

    // Serpents
    const intros: SnakeIntro[] = [];
    for (const [s, b] of boxes) {
      const known = c.knownSnakes.has(s);
      const m = known ? DROP_MARGIN : ADD_MARGIN;
      const inside = b[2] > cx - hw - m && b[0] < cx + hw + m && b[3] > cy - hh - m && b[1] < cy + hh + m;
      if (!inside) {
        if (known) {
          c.knownSnakes.delete(s);
          t.gone.push(s.id);
        }
        continue;
      }
      if (!known) {
        c.knownSnakes.add(s);
        intros.push({
          id: s.id, n: s.name, b: brandIndex(s.brand.id), p: s.isPlayer ? 1 : 0, m: s.mass, r: Math.round(s.r * 10) / 10,
          age: Math.round((w.time - s.bornAt) * 100) / 100, xs: s.xs.map(Math.round), ys: s.ys.map(Math.round),
        });
      }
      t.snakes.push(snakeState(s));
    }
    for (const s of c.knownSnakes) {
      if (!s.alive || !boxes.has(s)) {
        c.knownSnakes.delete(s);
        if (s.alive) t.gone.push(s.id);
      }
    }

    // Nourriture déjà connue : retraits et mises à jour.
    const sweep = this.ticks % 10 === 0;
    for (const f of c.knownFoods) {
      const by = eaten.get(f);
      if (by !== undefined) {
        t.rems.push([f.id, by]);
        c.knownFoods.delete(f);
      } else if (f.dead || (sweep && (Math.abs(f.x - cx) > hw + DROP_MARGIN || Math.abs(f.y - cy) > hh + DROP_MARGIN))) {
        t.rems.push([f.id, 0]);
        c.knownFoods.delete(f);
      } else if (f.dirty) {
        t.upds.push(foodUpd(f));
      }
    }
    // Nouvelle nourriture dans le champ.
    const ax = hw + ADD_MARGIN;
    const ay = hh + ADD_MARGIN;
    w.foodGrid.query(cx, cy, Math.hypot(ax, ay), (f) => {
      if (f.dead || c.knownFoods.has(f) || Math.abs(f.x - cx) > ax || Math.abs(f.y - cy) > ay) return;
      c.knownFoods.add(f);
      t.adds.push(foodAdd(f));
    });

    if (intros.length) c.send({ t: 'sn', l: intros });
    c.sock.send(writer.write(t));
  }

  private sendRoster() {
    const l: [number, string, number, number, number, number, 0 | 1][] = [];
    for (const s of this.world.snakes) {
      if (s.alive) l.push([s.id, s.name, brandIndex(s.brand.id), Math.round(s.x), Math.round(s.y), Math.round(s.mass * 10) / 10, s.isPlayer ? 1 : 0]);
    }
    const msg = JSON.stringify({ t: 'ro', l, h: this.clients.size } satisfies ServerJson);
    for (const c of this.clients) c.send(msg);
  }
}

function snakeState(s: Snake): SnakeState {
  return { id: s.id, x: s.x, y: s.y, angle: s.angle, want: s.wantAngle, mass: s.mass, boost: s.boosting };
}

const humanBits = (f: Food) => (f.state & 1) | ((f.sayT > 0 ? f.say + 1 : 0) << 1);

function foodAdd(f: Food): FoodAdd {
  const base = { id: f.id, kind: f.kind, x: f.x, y: f.y, vx: f.vx, vy: f.vy, a: 0, b: 0, c: 0, d: 0 };
  if (f.kind === ORB) {
    base.a = colorIndex(f.color);
    base.b = Math.min(255, Math.round(f.r * 4));
  } else if (f.kind === HUMAN) {
    base.a = f.skin;
    base.b = f.shirt;
    base.c = f.prop;
    base.d = humanBits(f);
  } else if (f.kind === LOGO) {
    base.a = f.logo;
  }
  return base;
}

function foodUpd(f: Food): FoodUpd {
  return { id: f.id, x: f.x, y: f.y, vx: f.vx, vy: f.vy, d: f.kind === HUMAN ? humanBits(f) : 0 };
}

/**
 * Boucle à cadence fixe, recalée sur l'horloge : des ticks réguliers évitent les à-coups côté client.
 * `step` est appelé à chaque tick ; renvoie une fonction d'arrêt.
 */
export function fixedLoop(step: () => void): () => void {
  const TICK_MS = 1000 / TICK_RATE;
  let nextAt = performance.now() - TICK_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    // Un tick par réveil au minimum : sur Cloudflare, l'horloge d'un Durable Object n'avance qu'aux
    // messages reçus, elle ne sert donc qu'à rattraper un vrai retard (jusqu'à 1 s).
    const now = performance.now();
    let n = 0;
    do {
      nextAt += TICK_MS;
      n++;
      step();
    } while (now >= nextAt && n < 30);
    if (now - nextAt > 1000) nextAt = now; // gros retard (machine endormie) : on repart sans rattraper
    timer = setTimeout(loop, Math.min(TICK_MS, Math.max(0, nextAt - now)));
  };
  loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
