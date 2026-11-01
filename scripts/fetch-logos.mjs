// Télécharge les logos du catalogue dans public/logos/<id>.svg
// Sources : svgl.app (logos couleur) et Simple Icons (glyphes monochromes, CC0).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const si = require('simple-icons');
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url)));
const out = new URL('../public/logos/', import.meta.url);
mkdirSync(out, { recursive: true });

const bySlug = Object.fromEntries(Object.values(si).filter((i) => i && i.slug).map((i) => [i.slug, i]));

function ensureSize(svg) {
  // Un SVG sans width/height ne se dessine pas partout dans un <canvas>.
  const open = svg.match(/<svg[^>]*>/)[0];
  if (/\swidth=/.test(open) && /\sheight=/.test(open) && !/width="\d*%"/.test(open)) return svg;
  const vb = open.match(/viewBox="([^"]+)"/);
  const [, , w, h] = vb ? vb[1].split(/[\s,]+/).map(Number) : [0, 0, 256, 256];
  const k = 256 / Math.max(w, h);
  const fixed = open.replace(/\s(width|height)="[^"]*"/g, '').replace('<svg', `<svg width="${Math.round(w * k)}" height="${Math.round(h * k)}"`);
  return svg.replace(open, fixed);
}

let ok = 0, fail = [];
for (const item of [...catalog.snakes, ...catalog.victims]) {
  if (item.src.startsWith('keep:')) {
    ok++; // logo maintenu à la main (ex. Jev, glyphe extrait du site TypeSafe)
    continue;
  }
  try {
    let svg;
    if (item.src.startsWith('svgl:')) {
      const res = await fetch(item.src.slice(5));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      svg = await res.text();
    } else {
      const icon = bySlug[item.src.slice(3)];
      if (!icon) throw new Error('slug inconnu');
      svg = icon.svg.replace('<svg ', `<svg fill="#${icon.hex}" `);
    }
    if (!svg.includes('<svg')) throw new Error('pas un SVG');
    writeFileSync(new URL(item.id + '.svg', out), ensureSize(svg));
    ok++;
  } catch (e) {
    fail.push(`${item.id} (${e.message})`);
  }
}
console.log(`${ok} logos OK`);
if (fail.length) console.log('Échecs :', fail.join(', '));
