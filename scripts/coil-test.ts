// Mesure la capacité d'un serpent à encercler : il tourne au maximum en continu,
// on relève le rayon du cercle que décrit sa tête et l'espace libre au centre.
// Usage : npx tsx scripts/coil-test.ts
import { World } from '../src/game/world';
import { BRANDS } from '../src/data/brands';

for (const mass of [60, 200, 500, 1200]) {
  const w = new World();
  w.snakes.length = 0; // arène vide : seul le serpent testé
  w.botTarget = 0;
  const s = w.addPlayer('test', BRANDS[0]);
  s.mass = mass;
  s.bornAt = -99;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 60 * 8; i++) {
    s.wantAngle = s.angle + 2; // toujours tourner à fond dans le même sens
    w.step(1 / 60);
    s.mass = mass;
    if (i > 60 * 5) {
      xs.push(s.x);
      ys.push(s.y);
    }
  }
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const r = xs.reduce((a, x, i) => a + Math.hypot(x - cx, ys[i] - cy), 0) / xs.length;
  console.log(`masse ${String(mass).padStart(4)} · rayon du corps ${s.r.toFixed(0).padStart(2)} px · cercle de la tête ${r.toFixed(0).padStart(3)} px · trou au centre ${(r - s.r).toFixed(0).padStart(3)} px`);
}
