import { BRANDS, VICTIMS, logoUrl } from '../data/brands';
import { SHIRTS, SKINS } from '../game/world';

const TAU = Math.PI * 2;

// Tous les visuels répétés sont pré-rendus une fois dans des canvas hors écran :
// à l'affichage on ne fait que des drawImage, rapides même sur mobile.

const canvas = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const shade = (hex: string, k: number) => {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

// ---------- Segments de serpent ----------

const BALL = 96;
const ballCache = new Map<string, HTMLCanvasElement>();
/** Boule brillante : base couleur, reflet en haut à gauche, bord sombre. */
export function ball(color: string) {
  let c = ballCache.get(color);
  if (c) return c;
  c = canvas(BALL);
  const g = c.getContext('2d')!;
  const m = BALL / 2;
  const grad = g.createRadialGradient(m * 0.7, m * 0.62, 2, m, m, m);
  grad.addColorStop(0, shade(color, 0.55));
  grad.addColorStop(0.35, color);
  grad.addColorStop(0.85, shade(color, -0.45));
  grad.addColorStop(1, shade(color, -0.75));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(m, m, m - 1, 0, Math.PI * 2);
  g.fill();
  ballCache.set(color, c);
  return c;
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** Halo additif (à dessiner en mode "lighter"). */
export function glow(color: string) {
  let c = glowCache.get(color);
  if (c) return c;
  c = canvas(64);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, rgba(color, 0.9));
  grad.addColorStop(0.25, rgba(color, 0.45));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

// ---------- Logos ----------

export const logoImages = new Map<string, HTMLImageElement>();

export async function loadLogos(onProgress?: (p: number) => void) {
  const ids = [...BRANDS.map((b) => b.id), ...VICTIMS.map((v) => v.id)];
  let done = 0;
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            logoImages.set(id, img);
            onProgress?.(++done / ids.length);
            resolve();
          };
          img.onerror = () => {
            onProgress?.(++done / ids.length);
            resolve();
          };
          img.src = logoUrl(id);
        }),
    ),
  );
}

function drawContained(g: CanvasRenderingContext2D, img: HTMLImageElement | undefined, cx: number, cy: number, box: number) {
  if (!img || !img.width) return;
  const k = box / Math.max(img.width, img.height);
  const w = img.width * k;
  const h = img.height * k;
  g.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

function squircle(g: CanvasRenderingContext2D, x: number, y: number, s: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, s, s, r);
}

const TOKEN = 128;
const tokenCache = new Map<number, HTMLCanvasElement>();
/** Une startup = une icône d'app blanche, comme sur un écran d'accueil. */
export function logoToken(index: number) {
  let c = tokenCache.get(index);
  if (c) return c;
  c = canvas(TOKEN);
  const g = c.getContext('2d')!;
  const pad = 10;
  const s = TOKEN - pad * 2;
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.fillStyle = '#FFFFFF';
  squircle(g, pad, pad, s, s * 0.27);
  g.fill();
  g.shadowColor = 'transparent';
  const grad = g.createLinearGradient(0, pad, 0, pad + s);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = grad;
  squircle(g, pad, pad, s, s * 0.27);
  g.fill();
  drawContained(g, logoImages.get(VICTIMS[index].id), TOKEN / 2, TOKEN / 2, s * 0.62);
  tokenCache.set(index, c);
  return c;
}

const badgeCache = new Map<string, HTMLCanvasElement>();
/** Tête du serpent : pastille blanche cerclée de la couleur de l'IA, logo au centre. */
export function headBadge(brandId: string) {
  let c = badgeCache.get(brandId);
  if (c) return c;
  const brand = BRANDS.find((b) => b.id === brandId)!;
  c = canvas(TOKEN);
  const g = c.getContext('2d')!;
  const m = TOKEN / 2;
  const ring = g.createLinearGradient(0, 0, TOKEN, TOKEN);
  brand.colors.forEach((col, i) => ring.addColorStop(i / Math.max(1, brand.colors.length - 1), col));
  g.fillStyle = ring;
  g.beginPath();
  g.arc(m, m, m - 2, 0, Math.PI * 2);
  g.fill();
  const inner = g.createRadialGradient(m * 0.8, m * 0.7, 4, m, m, m * 0.88);
  inner.addColorStop(0, '#FFFFFF');
  inner.addColorStop(1, '#E9E9EF');
  g.fillStyle = inner;
  g.beginPath();
  g.arc(m, m, m * 0.88, 0, Math.PI * 2);
  g.fill();
  drawContained(g, logoImages.get(brandId), m, m, TOKEN * 0.66);
  badgeCache.set(brandId, c);
  return c;
}

// ---------- Petits humains ----------

export const HUMAN_W = 30;
export const HUMAN_H = 42;
const HAIRS = ['#1B130C', '#4A2C17', '#D9B26A', '#A63A1E', '#9A9AA5', '#111111'];
const humanCache = new Map<number, HTMLCanvasElement>();

/**
 * Petit humain vu de trois quarts : visage (yeux, bouche), cheveux, jean, accessoire de bureau.
 * frame 0..3 = cycle de marche, panic = bras en l'air et bouche ouverte.
 * Un liseré clair autour de la silhouette le détache du fond sombre.
 */
export function human(skin: number, shirt: number, frame: number, panic: boolean, prop: number) {
  const key = (((skin * 16 + shirt) * 4 + frame) * 2 + (panic ? 1 : 0)) * 4 + prop;
  let c = humanCache.get(key);
  if (c) return c;
  const S = 2;
  const fig = canvas(HUMAN_W * S, HUMAN_H * S);
  const g = fig.getContext('2d')!;
  g.scale(S, S);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const cx = HUMAN_W / 2;
  const sw = [-1, 0, 1, 0][frame] * (panic ? 4 : 2.6);
  const skinC = SKINS[skin];
  const hair = HAIRS[(skin + shirt * 3) % HAIRS.length];

  // jambes en jean + chaussures
  g.strokeStyle = '#4C6FD1';
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(cx - 1.6, 27);
  g.lineTo(cx - 1.6 - sw, 34.5);
  g.moveTo(cx + 1.6, 27);
  g.lineTo(cx + 1.6 + sw, 34.5);
  g.stroke();
  g.fillStyle = '#F4F4F8';
  g.beginPath();
  g.ellipse(cx - 1.6 - sw + 0.8, 36, 2.4, 1.4, 0, 0, TAU);
  g.ellipse(cx + 1.6 + sw + 0.8, 36, 2.4, 1.4, 0, 0, TAU);
  g.fill();

  // torse
  g.fillStyle = SHIRTS[shirt];
  g.beginPath();
  g.roundRect(cx - 5.2, 16.5, 10.4, 11.5, [4, 4, 2.5, 2.5]);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(cx - 5.2, 25.5, 10.4, 2.5);

  // bras + mains
  g.strokeStyle = SHIRTS[shirt];
  g.lineWidth = 2.8;
  const hands: [number, number][] = panic
    ? [[cx - 8 + (frame & 1), 8], [cx + 8 - (frame & 1), 8]]
    : [[cx - 6.2 - sw * 0.6, 26], [cx + 6.2 + sw * 0.6, 26]];
  g.beginPath();
  g.moveTo(cx - 4.4, 18.5);
  g.lineTo(hands[0][0], hands[0][1]);
  g.moveTo(cx + 4.4, 18.5);
  g.lineTo(hands[1][0], hands[1][1]);
  g.stroke();
  g.fillStyle = skinC;
  for (const [hx, hy] of hands) {
    g.beginPath();
    g.arc(hx, hy, 1.7, 0, TAU);
    g.fill();
  }

  // accessoire (au calme seulement) : laptop, mallette ou café
  if (!panic && prop === 1) {
    g.fillStyle = '#B9BCC8';
    g.fillRect(cx + 4.5, 20.5, 7.5, 5.2);
    g.fillStyle = '#E8EAF2';
    g.beginPath();
    g.arc(cx + 8.2, 23.1, 1, 0, TAU);
    g.fill();
  } else if (!panic && prop === 2) {
    const [hx, hy] = hands[1];
    g.fillStyle = '#7A4A26';
    g.fillRect(hx - 3, hy + 0.5, 6.5, 5);
    g.strokeStyle = '#7A4A26';
    g.lineWidth = 1;
    g.strokeRect(hx - 1.2, hy - 1, 3, 1.6);
  } else if (!panic && prop === 3) {
    const [hx, hy] = hands[1];
    g.fillStyle = '#FFFFFF';
    g.fillRect(hx - 1.6, hy - 4.5, 3.6, 4.6);
    g.fillStyle = '#6B3F22';
    g.fillRect(hx - 1.6, hy - 3, 3.6, 1.4);
  }

  // tête
  g.fillStyle = skinC;
  g.beginPath();
  g.arc(cx, 10.5, 5.6, 0, TAU);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.arc(cx, 9.6, 5.8, Math.PI * 1.02, Math.PI * 1.98);
  g.fill();
  g.beginPath();
  g.ellipse(cx - 1.5, 6.4, 4.2, 2.2, -0.2, 0, TAU);
  g.fill();
  // visage tourné vers la droite (le sprite est retourné pour la gauche)
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(cx - 0.4, 10.6, panic ? 1.8 : 1.4, 0, TAU);
  g.arc(cx + 3.2, 10.6, panic ? 1.8 : 1.4, 0, TAU);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(cx + 0.1, 10.8, 0.8, 0, TAU);
  g.arc(cx + 3.7, 10.8, 0.8, 0, TAU);
  g.fill();
  if (panic) {
    g.fillStyle = '#3A0D12';
    g.beginPath();
    g.ellipse(cx + 1.6, 14.1, 1.5, 1.3, 0, 0, TAU);
    g.fill();
  } else {
    g.strokeStyle = '#5A2A1A';
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(cx + 1.6, 12.6, 1.4, 0.3, Math.PI - 0.3);
    g.stroke();
  }

  // liseré clair autour de la silhouette
  c = canvas(HUMAN_W * S, HUMAN_H * S);
  const o = c.getContext('2d')!;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * TAU;
    o.drawImage(fig, Math.cos(ang) * 2.2, Math.sin(ang) * 2.2);
  }
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = 'rgba(255,255,255,0.85)';
  o.fillRect(0, 0, c.width, c.height);
  o.globalCompositeOperation = 'source-over';
  o.drawImage(fig, 0, 0);
  humanCache.set(key, c);
  return c;
}

/** Ombre portée commune aux humains et aux icônes. */
export const shadowSprite = (() => {
  const c = canvas(32, 12);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 6, 0, 16, 6, 16);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.scale(1, 0.375);
  g.fillRect(0, 0, 32, 32);
  return c;
})();

/** Motif de fond : grille hexagonale façon circuit, très discrète. */
export function hexPattern() {
  const R = 46;
  const w = Math.sqrt(3) * R;
  const h = 3 * R;
  const c = canvas(Math.round(w), Math.round(h));
  const g = c.getContext('2d')!;
  g.fillStyle = '#07070D';
  g.fillRect(0, 0, c.width, c.height);
  const hex = (x: number, y: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = x + Math.cos(a) * (R - 3);
      const py = y + Math.sin(a) * (R - 3);
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
  };
  g.fillStyle = '#0B0C16';
  g.strokeStyle = '#1A1D30';
  g.lineWidth = 1.5;
  for (const [x, y] of [[0, 0], [w, 0], [w / 2, h / 2], [0, h], [w, h]] as const) {
    hex(x, y);
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#1E2236';
  for (const [x, y] of [[w / 2, h / 2], [0, 0], [w, h]] as const) {
    g.beginPath();
    g.arc(x, y, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
