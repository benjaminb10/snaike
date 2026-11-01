// Protocole réseau partagé par le serveur (Node) et le client (navigateur).
// Messages fréquents en binaire (petit-boutiste), messages rares en JSON.
import { BRANDS } from '../data/brands';
import { ORB_COLORS } from '../game/world';

export const PROTOCOL = 1;
export const TICK_RATE = 30; // envois par seconde
export const SUBSTEPS = 2; // pas de simulation par envoi (60 Hz comme en solo)

export const MSG_TICK = 1;
export const MSG_INPUT = 2;

// Positions en 1/8 de pixel, vitesses en 1/50 px/s, angles sur 16 bits.
export const POS = 8;
export const VEL = 50;
const ANG = 65536 / (Math.PI * 2);
export const packAngle = (a: number) => ((Math.round(a * ANG) % 65536) + 65536) % 65536;
export const unpackAngle = (v: number) => v / ANG;
const i16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Toutes les couleurs possibles d'un orbe, pour les envoyer en un octet. */
export const PALETTE: string[] = [...new Set([...ORB_COLORS, ...BRANDS.flatMap((b) => [...b.colors, b.glow])])];
const paletteIndex = new Map(PALETTE.map((c, i) => [c, i]));
export const colorIndex = (c: string) => paletteIndex.get(c) ?? 0;

export const brandIndex = (id: string) => Math.max(0, BRANDS.findIndex((b) => b.id === id));

// ---------- Client → serveur ----------

export interface InputMsg {
  angle: number;
  boost: boolean;
  cx: number; // centre de la caméra (spectateur)
  cy: number;
  hw: number; // demi-largeur visible
  hh: number;
}

export function encodeInput(m: InputMsg): ArrayBuffer {
  const b = new ArrayBuffer(12);
  const v = new DataView(b);
  v.setUint8(0, MSG_INPUT);
  v.setUint16(1, packAngle(m.angle), true);
  v.setUint8(3, m.boost ? 1 : 0);
  v.setInt16(4, i16(m.cx), true);
  v.setInt16(6, i16(m.cy), true);
  v.setUint16(8, Math.min(65535, Math.round(m.hw)), true);
  v.setUint16(10, Math.min(65535, Math.round(m.hh)), true);
  return b;
}

export function decodeInput(v: DataView): InputMsg | null {
  if (v.byteLength < 12 || v.getUint8(0) !== MSG_INPUT) return null;
  return {
    angle: unpackAngle(v.getUint16(1, true)),
    boost: (v.getUint8(3) & 1) === 1,
    cx: v.getInt16(4, true),
    cy: v.getInt16(6, true),
    hw: v.getUint16(8, true),
    hh: v.getUint16(10, true),
  };
}

// ---------- Serveur → client : le tick binaire ----------

export interface SnakeState {
  id: number;
  x: number;
  y: number;
  angle: number;
  want: number;
  mass: number;
  boost: boolean;
}

export interface FoodAdd {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number; // orbe : couleur · humain : peau · logo : index
  b: number; // orbe : rayon x4 · humain : t-shirt
  c: number; // humain : accessoire
  d: number; // humain : état (bit 0) + cri + 1 (bits 1..7)
}

export interface FoodUpd {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  d: number;
}

export interface Tick {
  time: number;
  me: number;
  kills: number;
  humans: number;
  snakes: SnakeState[];
  gone: number[];
  adds: FoodAdd[];
  upds: FoodUpd[];
  rems: [number, number][]; // [id nourriture, id du mangeur ou 0]
}

/** Écrit un tick ; les tableaux sont réutilisés par l'appelant. */
export class TickWriter {
  private buf = new ArrayBuffer(1 << 16);
  private v = new DataView(this.buf);
  private o = 0;

  private ensure(n: number) {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.o));
    this.buf = nb;
    this.v = new DataView(nb);
  }

  write(t: Tick): Uint8Array {
    this.o = 0;
    const need = 13 + 2 + t.snakes.length * 15 + 2 + t.gone.length * 2 + 2 + t.adds.length * 17 + 2 + t.upds.length * 13 + 2 + t.rems.length * 6;
    this.ensure(need);
    const v = this.v;
    let o = 0;
    v.setUint8(o, MSG_TICK); o += 1;
    v.setFloat32(o, t.time, true); o += 4;
    v.setUint16(o, t.me, true); o += 2;
    v.setUint16(o, Math.min(65535, t.kills), true); o += 2;
    v.setUint32(o, t.humans, true); o += 4;
    v.setUint16(o, t.snakes.length, true); o += 2;
    for (const s of t.snakes) {
      v.setUint16(o, s.id, true);
      v.setInt16(o + 2, i16(s.x * POS), true);
      v.setInt16(o + 4, i16(s.y * POS), true);
      v.setUint16(o + 6, packAngle(s.angle), true);
      v.setUint16(o + 8, packAngle(s.want), true);
      v.setFloat32(o + 10, s.mass, true);
      v.setUint8(o + 14, s.boost ? 1 : 0);
      o += 15;
    }
    v.setUint16(o, t.gone.length, true); o += 2;
    for (const id of t.gone) { v.setUint16(o, id, true); o += 2; }
    v.setUint16(o, t.adds.length, true); o += 2;
    for (const f of t.adds) {
      v.setUint32(o, f.id, true);
      v.setUint8(o + 4, f.kind);
      v.setInt16(o + 5, i16(f.x * POS), true);
      v.setInt16(o + 7, i16(f.y * POS), true);
      v.setInt16(o + 9, i16(f.vx * VEL), true);
      v.setInt16(o + 11, i16(f.vy * VEL), true);
      v.setUint8(o + 13, f.a);
      v.setUint8(o + 14, f.b);
      v.setUint8(o + 15, f.c);
      v.setUint8(o + 16, f.d);
      o += 17;
    }
    v.setUint16(o, t.upds.length, true); o += 2;
    for (const f of t.upds) {
      v.setUint32(o, f.id, true);
      v.setInt16(o + 4, i16(f.x * POS), true);
      v.setInt16(o + 6, i16(f.y * POS), true);
      v.setInt16(o + 8, i16(f.vx * VEL), true);
      v.setInt16(o + 10, i16(f.vy * VEL), true);
      v.setUint8(o + 12, f.d);
      o += 13;
    }
    v.setUint16(o, t.rems.length, true); o += 2;
    for (const [id, by] of t.rems) {
      v.setUint32(o, id, true);
      v.setUint16(o + 4, by, true);
      o += 6;
    }
    this.o = o;
    return new Uint8Array(this.buf, 0, o);
  }
}

export function readTick(v: DataView): Tick {
  let o = 1;
  const time = v.getFloat32(o, true); o += 4;
  const me = v.getUint16(o, true); o += 2;
  const kills = v.getUint16(o, true); o += 2;
  const humans = v.getUint32(o, true); o += 4;
  const snakes: SnakeState[] = [];
  let n = v.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++, o += 15) {
    snakes.push({
      id: v.getUint16(o, true),
      x: v.getInt16(o + 2, true) / POS,
      y: v.getInt16(o + 4, true) / POS,
      angle: unpackAngle(v.getUint16(o + 6, true)),
      want: unpackAngle(v.getUint16(o + 8, true)),
      mass: v.getFloat32(o + 10, true),
      boost: (v.getUint8(o + 14) & 1) === 1,
    });
  }
  const gone: number[] = [];
  n = v.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++, o += 2) gone.push(v.getUint16(o, true));
  const adds: FoodAdd[] = [];
  n = v.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++, o += 17) {
    adds.push({
      id: v.getUint32(o, true),
      kind: v.getUint8(o + 4),
      x: v.getInt16(o + 5, true) / POS,
      y: v.getInt16(o + 7, true) / POS,
      vx: v.getInt16(o + 9, true) / VEL,
      vy: v.getInt16(o + 11, true) / VEL,
      a: v.getUint8(o + 13),
      b: v.getUint8(o + 14),
      c: v.getUint8(o + 15),
      d: v.getUint8(o + 16),
    });
  }
  const upds: FoodUpd[] = [];
  n = v.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++, o += 13) {
    upds.push({
      id: v.getUint32(o, true),
      x: v.getInt16(o + 4, true) / POS,
      y: v.getInt16(o + 6, true) / POS,
      vx: v.getInt16(o + 8, true) / VEL,
      vy: v.getInt16(o + 10, true) / VEL,
      d: v.getUint8(o + 12),
    });
  }
  const rems: [number, number][] = [];
  n = v.getUint16(o, true); o += 2;
  for (let i = 0; i < n; i++, o += 6) rems.push([v.getUint32(o, true), v.getUint16(o + 4, true)]);
  return { time, me, kills, humans, snakes, gone, adds, upds, rems };
}

// ---------- Messages JSON ----------

/** Présentation d'un serpent qui entre dans le champ : nom, marque et corps complet. */
export interface SnakeIntro {
  id: number;
  n: string;
  b: number;
  p: 0 | 1;
  m: number;
  r: number;
  age: number;
  xs: number[];
  ys: number[];
}

export type ServerJson =
  | { t: 'hello'; v: number; room: number }
  | { t: 'you'; id: number }
  | { t: 'sn'; l: SnakeIntro[] }
  | { t: 'die'; id: number; n: string; b: number; p: 0 | 1; x: number; y: number; k: number; kn: string; kb: number; kp: 0 | 1 }
  | { t: 'ro'; l: [number, string, number, number, number, number, 0 | 1][]; h: number };

export type ClientJson = { t: 'join'; n: string; b: string };

/** Nettoie un pseudo : caractères imprimables, 16 max. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
