export const TAU = Math.PI * 2;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Écart d'angle signé dans [-PI, PI]. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Point uniforme dans un disque de rayon r. */
export function randInDisc(r: number): [number, number] {
  const a = Math.random() * TAU;
  const d = Math.sqrt(Math.random()) * r;
  return [Math.cos(a) * d, Math.sin(a) * d];
}
