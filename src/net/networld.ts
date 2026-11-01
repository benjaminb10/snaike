// Monde côté client en ligne : reflète l'arène du serveur et extrapole entre deux ticks
// pour rester fluide à 60+ i/s. Même forme que World pour le rendu et l'interface.
import { BRANDS, type Brand } from '../data/brands';
import { BASE_SPEED, BOOST_SPEED, MIN_BOOST_MASS, radiusOf, scoreOf, turnRateOf } from '../game/config';
import { TAU, angleDiff } from '../game/math';
import { HUMAN, LOGO, ORB, Snake, moveFood, steer, type ArenaView, type Food, type GameEvent, type RankEntry } from '../game/world';
import {
  MSG_TICK, PALETTE, PROTOCOL, TICK_RATE, encodeInput, readTick,
  type FoodAdd, type ServerJson, type SnakeIntro, type Tick,
} from './protocol';
import { wsUrl } from './url';

export { wsUrl };

interface Corr {
  x: number;
  y: number;
  a: number;
}

export class NetWorld implements ArenaView {
  snakes: Snake[] = [];
  foods: Food[] = [];
  player: Snake | null = null;
  time = 0;
  events: GameEvent[] = [];
  /** Champ de vision envoyé au serveur (centre de caméra quand on regarde, demi-taille). */
  view = { x: 0, y: 0, hw: 1000, hh: 700 };
  online = 0;
  room = 0;
  onSpawn: ((p: Snake) => void) | null = null;
  onClose: (() => void) | null = null;

  private ws: WebSocket;
  private byId = new Map<number, Snake>();
  private corr = new Map<number, Corr>();
  private foodById = new Map<number, Food>();
  private roster: RankEntry[] = [];
  private myId = 0;
  private pendingMe = 0;
  private sendAcc = 0;
  private sinceSent = 0;
  private sent = { angle: NaN, boost: false, hw: 0, hh: 0 };
  private lastTickAt = 0;
  private clockOff = Infinity; // horloge locale moins horloge serveur, au plus court trajet récent
  private offMins = [Infinity, Infinity, Infinity]; // plus court trajet de chacune des 3 dernières secondes
  private offAt = 0;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = () => this.onClose?.();
  }

  /** Se connecte ; rejette si le serveur ne répond pas vite (on joue alors hors ligne). */
  static connect(url = wsUrl(), timeout = 3000): Promise<NetWorld> {
    return new Promise((res, rej) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        rej(e);
        return;
      }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        ws.close();
        rej(new Error('timeout'));
      }, timeout);
      ws.onerror = () => {
        clearTimeout(timer);
        rej(new Error('ws error'));
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data) as ServerJson;
        if (m.t !== 'hello') return;
        clearTimeout(timer);
        if (m.v !== PROTOCOL) {
          ws.close();
          rej(new Error('protocol'));
          return;
        }
        const w = new NetWorld(ws);
        w.room = m.room;
        res(w);
      };
    });
  }

  get connected() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    this.ws.onclose = null;
    this.ws.close();
  }

  join(name: string, brand: Brand) {
    this.player = null;
    this.pendingMe = 0;
    this.send(JSON.stringify({ t: 'join', n: name, b: brand.id }));
  }

  private send(d: string | ArrayBuffer) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(d);
  }

  /** Classement complet (serveur toutes les 0,5 s, positions fraîches pour les serpents visibles). */
  ranking(): RankEntry[] {
    const out: RankEntry[] = [];
    const seen = new Set<number>();
    for (const e of this.roster) {
      const s = this.byId.get(e.id);
      if (s && !s.alive) continue;
      out.push(s ?? e);
      seen.add(e.id);
    }
    const p = this.player;
    if (p?.alive && !seen.has(p.id)) out.push(p);
    return out.sort((a, b) => b.mass - a.mass);
  }

  // ---------- Réception ----------

  private onMessage(data: unknown) {
    if (typeof data === 'string') {
      this.onJson(JSON.parse(data) as ServerJson);
      return;
    }
    const v = new DataView(data as ArrayBuffer);
    if (v.getUint8(0) === MSG_TICK) this.onTick(readTick(v));
  }

  private onJson(m: ServerJson) {
    switch (m.t) {
      case 'you':
        this.pendingMe = m.id;
        break;
      case 'sn':
        for (const it of m.l) this.intro(it);
        break;
      case 'die':
        this.die(m);
        break;
      case 'ro':
        this.online = m.h;
        this.roster = m.l.map(([id, n, b, x, y, mass, p]) => ({
          id, name: n, brand: BRANDS[b] ?? BRANDS[0], mass, score: scoreOf(mass), x, y, r: radiusOf(mass), isPlayer: p === 1,
        }));
        break;
    }
  }

  private intro(it: SnakeIntro) {
    const old = this.byId.get(it.id);
    if (old) this.removeSnake(old);
    const n = it.xs.length;
    const s = new Snake(it.id, it.n, BRANDS[it.b] ?? BRANDS[0], it.xs[0], it.ys[0], it.m, it.p === 1, this.time);
    s.r = it.r;
    s.bornAt = this.time - it.age;
    if (n > 1) s.angle = s.wantAngle = Math.atan2(it.ys[0] - it.ys[1], it.xs[0] - it.xs[1]);
    // La trace va de la queue vers la tête.
    s.trailX = it.xs.slice().reverse();
    s.trailY = it.ys.slice().reverse();
    s.updateBody();
    this.snakes.push(s);
    this.byId.set(s.id, s);
    this.corr.set(s.id, { x: 0, y: 0, a: 0 });
    if (it.id === this.pendingMe) this.adoptPlayer(s);
  }

  private adoptPlayer(s: Snake) {
    this.player = s;
    this.myId = s.id;
    this.pendingMe = 0;
    this.onSpawn?.(s);
  }

  private stub(id: number, name: string, b: number, p: 0 | 1, x: number, y: number): Snake {
    const s = new Snake(id, name, BRANDS[b] ?? BRANDS[0], x, y, 10, p === 1, this.time);
    s.xs = [];
    s.ys = [];
    s.alive = false;
    s.diedAt = this.time;
    return s;
  }

  private die(m: Extract<ServerJson, { t: 'die' }>) {
    const killer = m.k ? (this.byId.get(m.k) ?? this.stub(m.k, m.kn, m.kb, m.kp, 0, 0)) : null;
    let s = this.byId.get(m.id);
    if (s) {
      s.alive = false;
      s.diedAt = this.time;
    } else s = this.stub(m.id, m.n, m.b, m.p, m.x, m.y);
    s.killedBy = killer;
    if (m.id === this.myId && this.player) {
      if (this.player !== s) {
        this.player.alive = false;
        this.player.diedAt = this.time;
        this.player.killedBy = killer;
      }
      s = this.player;
    }
    if (killer?.id === this.myId && this.player) {
      this.events.push({ type: 'kill', snake: this.player, victim: s });
    }
    this.events.push({ type: 'death', snake: s, killer: killer?.id === this.myId ? this.player : killer });
  }

  private removeSnake(s: Snake) {
    const i = this.snakes.indexOf(s);
    if (i >= 0) this.snakes.splice(i, 1);
    this.byId.delete(s.id);
    this.corr.delete(s.id);
  }

  private onTick(t: Tick) {
    this.lastTickAt = this.time;
    // Âge du tick : retard au-delà du trajet le plus court observé (rattrape la gigue réseau).
    // Minimum glissant sur 3 s : suit aussi un décalage durable (pause du serveur au démarrage).
    const off = this.time - t.time;
    if (this.time - this.offAt >= 1) {
      this.offAt = this.time;
      this.offMins.shift();
      this.offMins.push(Infinity);
    }
    const m = this.offMins;
    if (off < m[2]) m[2] = off;
    this.clockOff = Math.min(m[0], m[1], m[2]);
    const age = Math.min(0.25, off - this.clockOff);
    const p = this.player;
    if (p && t.me === p.id) {
      p.kills = t.kills;
      p.humans = t.humans;
    }
    for (const st of t.snakes) {
      const s = this.byId.get(st.id);
      if (!s) continue;
      const c = this.corr.get(st.id)!;
      const mine = s === p;
      s.mass = st.mass;
      if (s.mass > s.peak) s.peak = s.mass;
      // Où est le serpent maintenant : on rejoue son virage vers l'angle visé pendant l'âge du tick
      // (une ligne droite se trompe à chaque virage dès que le réseau a 100 ms de gigue).
      const speed = st.boost ? BOOST_SPEED : BASE_SPEED;
      const rate = turnRateOf(st.mass) * (st.boost ? 0.85 : 1);
      let px = st.x, py = st.y, pa = st.angle;
      for (let left = age; left > 1e-4; left -= 1 / 120) {
        const h = Math.min(1 / 120, left);
        const d = angleDiff(pa, st.want);
        pa += Math.max(-rate * h, Math.min(rate * h, d));
        px += Math.cos(pa) * speed * h;
        py += Math.sin(pa) * speed * h;
      }
      const dx = px - s.x;
      const dy = py - s.y;
      if (dx * dx + dy * dy > 220 * 220) {
        // Trop loin : on recale net.
        s.x = st.x;
        s.y = st.y;
        c.x = c.y = 0;
      } else {
        c.x = dx;
        c.y = dy;
      }
      const da = angleDiff(s.angle, pa);
      if (!mine) {
        c.a = da;
        s.wantAngle = st.want;
        s.boosting = st.boost;
      } else if (Math.abs(da) > 1.2) s.angle = st.angle;
    }
    for (const id of t.gone) {
      const s = this.byId.get(id);
      if (s && s !== p) this.removeSnake(s);
    }
    for (const a of t.adds) this.addFood(a);
    for (const u of t.upds) {
      const f = this.foodById.get(u.id);
      if (!f) continue;
      f.x = u.x;
      f.y = u.y;
      f.vx = u.vx;
      f.vy = u.vy;
      if (f.kind === HUMAN) this.humanBits(f, u.d);
    }
    for (const [id, by] of t.rems) {
      const f = this.foodById.get(id);
      if (!f) continue;
      this.foodById.delete(id);
      f.dead = true;
      if (!by) continue;
      const s = this.byId.get(by);
      if (!s) continue;
      s.eatPulse = Math.min(1, s.eatPulse + (f.kind === LOGO ? 1 : 0.35));
      if (f.kind !== ORB) {
        s.gulps.push(this.time);
        if (s.gulps.length > 8) s.gulps.shift();
      }
      if (s === p && f.kind === LOGO) p.logos.push(f.logo);
      this.events.push({ type: 'eat', snake: s, food: f });
    }
  }

  private humanBits(f: Food, d: number) {
    f.state = d & 1;
    const say = (d >> 1) - 1;
    if (say >= 0 && (say !== f.say || f.sayT <= 0)) {
      if (say !== f.say || f.sayT <= 0) f.sayT = 1.6;
      f.say = say;
    }
  }

  private addFood(a: FoodAdd) {
    if (this.foodById.has(a.id)) return;
    const f: Food = {
      id: a.id, kind: a.kind, x: a.x, y: a.y, vx: a.vx, vy: a.vy, r: 4, value: 1, color: '#fff', logo: 0, skin: 0, shirt: 0,
      phase: Math.random() * TAU, state: 0, timer: 0, born: this.time, ttl: 0, dead: false, sucked: 0, dir: a.vx < 0 ? -1 : 1,
      ambient: false, prop: 0, say: -1, sayT: 0, dirty: false,
    };
    if (a.kind === ORB) {
      f.color = PALETTE[a.a] ?? '#fff';
      f.r = a.b / 4;
    } else if (a.kind === HUMAN) {
      f.r = 10;
      f.skin = a.a;
      f.shirt = a.b;
      f.prop = a.c;
      this.humanBits(f, a.d);
    } else if (a.kind === LOGO) {
      f.r = 17;
      f.logo = a.a;
    }
    this.foods.push(f);
    this.foodById.set(f.id, f);
  }

  // ---------- Simulation locale (extrapolation) ----------

  step(dt: number) {
    this.time += dt;
    const kMe = 1 - Math.exp(-dt * 14);
    const kOther = 1 - Math.exp(-dt * 8); // plus doux : la gigue de Cloudflare arrive par paquets de 100 ms
    const p = this.player;
    for (const s of this.snakes) {
      if (!s.alive) continue;
      steer(s, dt);
      if (s === p) s.boosting = s.wantBoost && s.mass > MIN_BOOST_MASS;
      const speed = s.boosting ? BOOST_SPEED : BASE_SPEED;
      s.x += Math.cos(s.angle) * speed * dt;
      s.y += Math.sin(s.angle) * speed * dt;
      const c = this.corr.get(s.id);
      if (c) {
        const k = s === p ? kMe : kOther;
        s.x += c.x * k;
        s.y += c.y * k;
        s.angle += c.a * k;
        c.x -= c.x * k;
        c.y -= c.y * k;
        c.a -= c.a * k;
      }
      s.r += (radiusOf(s.mass) - s.r) * Math.min(1, dt * 3);
      s.eatPulse = Math.max(0, s.eatPulse - dt * 3);
      s.updateBody();
    }
    // Les serpents morts restent le temps de l'animation.
    for (let i = this.snakes.length - 1; i >= 0; i--) {
      const s = this.snakes[i];
      if (!s.alive && this.time - s.diedAt > 1.2 && s !== p) this.removeSnake(s);
    }

    let w = 0;
    for (const f of this.foods) {
      if (f.dead) continue;
      moveFood(f, dt);
      this.foods[w++] = f;
    }
    this.foods.length = w;

    // Commandes et champ de vision vers le serveur, au plus au rythme des ticks et seulement quand
    // elles changent (au moins 4 fois par seconde) : le quota gratuit du serveur compte les messages reçus.
    this.sendAcc += dt;
    this.sinceSent += dt;
    if (this.sendAcc >= 1 / TICK_RATE) {
      this.sendAcc = 0;
      const angle = p?.wantAngle ?? 0;
      const boost = p?.wantBoost ?? false;
      const v = this.view;
      const last = this.sent;
      const changed = !(Math.abs(angleDiff(last.angle, angle)) < 0.01) || boost !== last.boost || Math.abs(v.hw - last.hw) > 40 || Math.abs(v.hh - last.hh) > 40;
      if (changed || this.sinceSent >= 0.25) {
        this.sinceSent = 0;
        last.angle = angle;
        last.boost = boost;
        last.hw = v.hw;
        last.hh = v.hh;
        this.send(encodeInput({ angle, boost, cx: v.x, cy: v.y, hw: v.hw, hh: v.hh }));
      }
    }
  }

  /** Secondes depuis le dernier tick reçu (pour détecter un serveur figé). */
  get silence() {
    return this.time - this.lastTickAt;
  }
}
