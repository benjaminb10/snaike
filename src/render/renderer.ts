import { VICTIMS } from '../data/brands';
import { WORLD_R } from '../game/config';
import { TAU, clamp, lerp, rand } from '../game/math';
import { HUMAN, LOGO, SHIRTS, SHOUTS, type GameEvent, type ArenaView, type Snake } from '../game/world';
import type { Billboard } from '../sponsors';
import { HUMAN_H, HUMAN_W, ball, glow, headBadge, hexPattern, human, logoToken, resetSprites, rgba, shadowSprite } from './sprites';

const BB = 900; // rayon d'influence du panneau sponsor (pour le culling)

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 0 | 1 | 2; // 0 étincelle, 1 onde, 2 texte
  text?: string;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;
  cam = { x: 0, y: 0, zoom: 1 };
  billboard: Billboard | null = null;
  onBillboard: ((b: Billboard) => void) | null = null;
  private shake = 0;
  private flash = 0;
  private flashColor = '#ffffff';
  private particles: Particle[] = [];
  private pattern: CanvasPattern;
  private vignette: HTMLCanvasElement | null = null;
  boostLines = 0;
  menuMode = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.pattern = this.ctx.createPattern(hexPattern(), 'repeat')!;
    this.resize();
    addEventListener('resize', () => this.resize());
    // Contexte graphique perdu puis rendu par le navigateur (mémoire GPU saturée, onglets nombreux) :
    // tous les canvas en cache sont vides, on les reconstruit.
    this.listen(canvas);
  }

  private listen(canvas: HTMLCanvasElement) {
    canvas.addEventListener('contextlost', () => this.onLost());
    canvas.addEventListener('contextrestored', () => this.rebuild());
  }

  /** Contexte jamais rendu (Dia, Chrome avec beaucoup d'onglets) : un canvas neuf obtient un contexte neuf. */
  private replaceCanvas() {
    const fresh = this.canvas.cloneNode(false) as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.ctx = fresh.getContext('2d', { alpha: false })!;
    this.listen(fresh);
    this.resize();
    this.rebuild();
  }

  private lost = false;
  private lowRes = false;
  private checkAt = 0;

  /** Filet de sécurité si les événements ne viennent pas : surveille le contexte deux fois par seconde. */
  private watchContext(now: number) {
    if (now < this.checkAt) return;
    this.checkAt = now + 500;
    const lost = this.ctx.isContextLost?.() ?? false;
    if (lost) {
      this.onLost();
      // Toujours perdu après 1,5 s : on le remplace par un canvas neuf, en définition standard.
      // Au plus 3 fois : dans un navigateur saturé, remplacer en boucle ferait clignoter l'écran.
      if (now - this.lostAt > 1500 && this.replaced < 3) {
        this.replaced++;
        this.replaceCanvas();
      }
    } else if (this.lost) this.rebuild();
  }

  private lostAt = 0;
  private replaced = 0;

  /** Mémoire graphique saturée : on passe en définition standard (4 fois moins de mémoire en Retina). */
  private onLost() {
    if (!this.lost) this.lostAt = performance.now();
    this.lost = true;
    this.lowRes = true;
  }

  /** Contexte rendu : les canvas en cache sont vides, on les refait. Pas de resize inutile, il redemanderait la mémoire. */
  rebuild() {
    this.lost = false;
    resetSprites();
    this.pattern = this.ctx.createPattern(hexPattern(), 'repeat')!;
    if (this.lowRes && this.dpr > 1) this.resize();
  }

  resize() {
    this.dpr = this.lowRes ? 1 : Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    const v = document.createElement('canvas');
    v.width = 512;
    v.height = 512;
    const g = v.getContext('2d')!;
    const grad = g.createRadialGradient(256, 256, 120, 256, 256, 362);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    this.vignette = v;
  }

  private baseZoom() {
    return clamp(Math.sqrt(this.w * this.h) / 1100, 0.64, 1.3);
  }

  /** Caméra : suit une cible, dézoome quand le serpent grossit. */
  follow(x: number, y: number, r: number, boosting: boolean, dt: number) {
    const size = 1 / (1 + (r - 11) / 34);
    const target = this.baseZoom() * size * (boosting ? 0.93 : 1) * (this.menuMode ? 0.7 : 1);
    const k = 1 - Math.exp(-dt * 7);
    this.cam.x = lerp(this.cam.x, x, k);
    this.cam.y = lerp(this.cam.y, y, k);
    this.cam.zoom = lerp(this.cam.zoom, target, 1 - Math.exp(-dt * 2.5));
  }

  snapTo(x: number, y: number) {
    this.cam.x = x;
    this.cam.y = y;
  }

  addShake(v: number) {
    this.shake = Math.max(this.shake, v);
  }

  addFlash(v: number, color = '#ffffff') {
    this.flash = Math.max(this.flash, v);
    this.flashColor = color;
  }

  private spark(x: number, y: number, color: string, n: number, speed: number, size = 3, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * rand(0.3, 1);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * rand(0.6, 1), max: life, size: size * rand(0.6, 1.4), color, kind: 0 });
    }
  }

  private ring(x: number, y: number, color: string, size: number, life = 0.45) {
    this.particles.push({ x, y, vx: 0, vy: 0, life, max: life, size, color, kind: 1 });
  }

  private text(x: number, y: number, text: string, color: string, size: number, life = 1) {
    this.particles.push({ x, y, vx: 0, vy: -60, life, max: life, size, color, kind: 2, text });
  }

  handleEvents(events: GameEvent[], world: ArenaView) {
    const player = world.player;
    for (const e of events) {
      if (e.type === 'eat') {
        const f = e.food;
        const mine = e.snake === player;
        if (!this.onScreen(f.x, f.y, 60)) continue;
        if (f.kind === HUMAN) {
          this.spark(f.x, f.y, SHIRTS[f.shirt], mine ? 7 : 3, 140, 2.6, 0.45);
        } else if (f.kind === LOGO) {
          this.ring(f.x, f.y, e.snake.brand.glow, 60, 0.5);
          this.spark(f.x, f.y, '#FFFFFF', 16, 320, 3.2, 0.6);
          this.spark(f.x, f.y, e.snake.brand.glow, 10, 220, 4, 0.7);
          if (mine) {
            this.text(f.x, f.y - 30, VICTIMS[f.logo].name.toUpperCase(), '#FFFFFF', 20, 1.1);
            this.addShake(4);
          }
        } else if (mine && Math.random() < 0.5) {
          this.spark(f.x, f.y, f.color, 2, 90, 2, 0.3);
        }
      } else if (e.type === 'death') {
        const s = e.snake;
        if (!this.onScreen(s.x, s.y, 800)) continue;
        for (let j = 0; j < s.xs.length; j += 3) {
          this.spark(s.xs[j], s.ys[j], s.brand.colors[(j >> 2) % s.brand.colors.length], 2, 260, 4, 0.8);
        }
        this.ring(s.x, s.y, '#FFFFFF', 140, 0.6);
        this.ring(s.x, s.y, s.brand.glow, 90, 0.8);
        if (s === player) {
          this.addShake(26);
          this.addFlash(0.8, '#FF2D55');
        } else if (e.killer === player) {
          this.addShake(16);
          this.addFlash(0.35, player!.brand.glow);
          this.text(s.x, s.y - 50, 'CUT OFF!', player!.brand.glow, 46, 1.4);
        } else {
          const d = Math.hypot(s.x - this.cam.x, s.y - this.cam.y);
          this.addShake(clamp(10 - d / 120, 0, 8));
        }
      }
    }
  }

  viewHalfW() {
    return this.w / 2 / this.cam.zoom;
  }
  viewHalfH() {
    return this.h / 2 / this.cam.zoom;
  }
  private onScreen(x: number, y: number, m: number) {
    return Math.abs(x - this.cam.x) < this.viewHalfW() + m && Math.abs(y - this.cam.y) < this.viewHalfH() + m;
  }

  render(world: ArenaView, dt: number) {
    this.watchContext(performance.now());
    const g = this.ctx;
    const t = world.time;
    const z = this.cam.zoom;
    this.shake *= Math.exp(-dt * 9);
    this.flash *= Math.exp(-dt * 5);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // Monde
    g.save();
    g.translate(this.w / 2 + sx, this.h / 2 + sy);
    g.scale(z, z);
    g.translate(-this.cam.x, -this.cam.y);
    const hw = this.viewHalfW() + 40;
    const hh = this.viewHalfH() + 40;
    const x0 = this.cam.x - hw;
    const y0 = this.cam.y - hh;

    g.fillStyle = this.pattern;
    g.fillRect(x0, y0, hw * 2, hh * 2);
    this.drawArena(g, t, x0, y0, hw, hh);
    if (this.billboard && Math.abs(this.cam.x) < hw + BB && Math.abs(this.cam.y) < hh + BB) {
      this.drawBillboard(g, this.billboard, t);
      if (Math.abs(this.cam.x) < hw && Math.abs(this.cam.y) < hh) this.onBillboard?.(this.billboard);
    }

    // Nourriture
    const foods = world.foods;
    g.globalCompositeOperation = 'lighter';
    for (const f of foods) {
      if (f.kind !== 0 || Math.abs(f.x - this.cam.x) > hw || Math.abs(f.y - this.cam.y) > hh) continue;
      const pulse = 0.75 + Math.sin(f.phase * 2) * 0.25;
      const s = f.r * 5 * pulse;
      g.drawImage(glow(f.color), f.x - s / 2, f.y - s / 2, s, s);
    }
    g.globalCompositeOperation = 'source-over';
    for (const f of foods) {
      if (f.kind !== 0 || Math.abs(f.x - this.cam.x) > hw || Math.abs(f.y - this.cam.y) > hh) continue;
      const s = f.r * 1.25;
      g.drawImage(ball(f.color), f.x - s / 2, f.y - s / 2, s, s);
    }
    for (const f of foods) {
      if (f.kind !== HUMAN || Math.abs(f.x - this.cam.x) > hw || Math.abs(f.y - this.cam.y) > hh) continue;
      this.drawHuman(g, f, t);
    }
    for (const f of foods) {
      if (f.kind !== LOGO || Math.abs(f.x - this.cam.x) > hw || Math.abs(f.y - this.cam.y) > hh) continue;
      this.drawLogo(g, f, t);
    }

    // Serpents (le joueur au-dessus)
    for (const s of world.snakes) if (s !== world.player) this.drawSnake(g, s, t, hw, hh);
    if (world.player) this.drawSnake(g, world.player, t, hw, hh);
    if (!this.menuMode) for (const s of world.snakes) if (s.alive && s !== world.player) this.drawName(g, s);

    this.drawParticles(g, dt, z);
    g.restore();

    // Écran
    if (this.boostLines > 0.01) this.drawSpeedLines(g);
    if (this.vignette) g.drawImage(this.vignette, 0, 0, this.w, this.h);
    if (this.flash > 0.01) {
      g.globalAlpha = Math.min(0.6, this.flash);
      g.fillStyle = this.flashColor;
      g.globalCompositeOperation = 'lighter';
      g.fillRect(0, 0, this.w, this.h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
  }

  /** Panneau sponsor géant posé au sol, au centre de la carte. */
  private drawBillboard(g: CanvasRenderingContext2D, b: Billboard, t: number) {
    const S = 420;
    const c = b.sponsor.color;
    g.save();
    // Halo et anneaux qui tournent
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5 + Math.sin(t * 2) * 0.1;
    const halo = glow(c);
    g.drawImage(halo, -S * 1.6, -S * 1.6, S * 3.2, S * 3.2);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.5;
    g.strokeStyle = c;
    g.lineWidth = 6;
    g.setLineDash([60, 30]);
    g.lineDashOffset = -t * 60;
    g.beginPath();
    g.arc(0, 0, S * 0.98, 0, TAU);
    g.stroke();
    g.lineDashOffset = t * 40;
    g.globalAlpha = 0.25;
    g.beginPath();
    g.arc(0, 0, S * 1.15, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    // Tuile du logo
    g.globalAlpha = 0.92;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(-S / 2, -S / 2, S, S, S * 0.22);
    g.fill();
    const pad = S * 0.12;
    g.save();
    g.beginPath();
    g.roundRect(-S / 2 + pad, -S / 2 + pad, S - pad * 2, S - pad * 2, S * 0.14);
    g.clip();
    g.drawImage(b.img, -S / 2 + pad, -S / 2 + pad, S - pad * 2, S - pad * 2);
    g.restore();
    // Textes
    g.globalAlpha = 0.85;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(244,244,248,0.7)';
    g.font = '800 34px "JetBrains Mono", monospace';
    g.fillText('ARENA PRESENTED BY', 0, -S / 2 - 46);
    g.fillStyle = c;
    g.font = 'italic 900 92px Unbounded, sans-serif';
    g.fillText(b.sponsor.name.toUpperCase(), 0, S / 2 + 120);
    g.restore();
  }

  private drawArena(g: CanvasRenderingContext2D, t: number, x0: number, y0: number, hw: number, hh: number) {
    const near = Math.hypot(this.cam.x, this.cam.y) + Math.hypot(hw, hh) > WORLD_R;
    if (!near) return;
    g.save();
    g.beginPath();
    g.rect(x0, y0, hw * 2, hh * 2);
    g.arc(0, 0, WORLD_R, 0, TAU, true);
    g.fillStyle = 'rgba(255,20,60,0.13)';
    g.fill('evenodd');
    const pulse = 0.6 + Math.sin(t * 5) * 0.4;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,40,80,${0.12 * pulse})`;
    g.lineWidth = 70;
    g.beginPath();
    g.arc(0, 0, WORLD_R, 0, TAU);
    g.stroke();
    g.strokeStyle = `rgba(255,60,100,${0.85})`;
    g.lineWidth = 6;
    g.setLineDash([40, 22]);
    g.lineDashOffset = -t * 80;
    g.stroke();
    g.restore();
  }

  private drawHuman(g: CanvasRenderingContext2D, f: ArenaView['foods'][number], t: number) {
    const panic = f.state === 1 || f.sucked > 0;
    const frame = (f.phase | 0) & 3;
    const img = human(f.skin, f.shirt, frame, panic, f.prop);
    const w = HUMAN_W * 0.85;
    const h = HUMAN_H * 0.85;
    const bob = panic ? Math.abs(Math.sin(f.phase * 1.6)) * 2.5 : 0;
    g.drawImage(shadowSprite, f.x - 10, f.y + h * 0.33, 20, 7);
    if (f.sucked > 0) {
      g.save();
      g.translate(f.x, f.y);
      g.rotate(t * 14 + f.phase);
      g.drawImage(img, -w / 2, -h / 2, w * 0.85, h * 0.85);
      g.restore();
      return;
    }
    if (f.dir < 0) {
      // Retourné au dessin plutôt qu'en cache : une image de moins par apparence en mémoire graphique.
      g.save();
      g.translate(f.x, 0);
      g.scale(-1, 1);
      g.drawImage(img, -w / 2, f.y - h / 2 - bob, w, h);
      g.restore();
    } else g.drawImage(img, f.x - w / 2, f.y - h / 2 - bob, w, h);
    if (f.sayT > 0 && f.say >= 0 && this.cam.zoom > 0.5) {
      this.drawShout(g, f.x, f.y - h / 2 - 6 - bob, SHOUTS[f.say], f.sayT);
    } else if (f.state === 1 && this.cam.zoom > 0.55) {
      g.fillStyle = '#FF3355';
      g.font = '900 15px Unbounded, sans-serif';
      g.fillText('!', f.x - 4, f.y - h / 2 - 4 - bob);
    }
  }

  private drawShout(g: CanvasRenderingContext2D, x: number, y: number, text: string, life: number) {
    const a = Math.min(1, life * 3);
    const pop = life > 1.45 ? 1 + (life - 1.45) * 3 : 1;
    g.globalAlpha = a;
    g.font = `800 ${10 * pop}px Unbounded, sans-serif`;
    const w = g.measureText(text).width + 12;
    const h = 17 * pop;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.roundRect(x - w / 2, y - h, w, h, 6);
    g.moveTo(x - 4, y);
    g.lineTo(x, y + 5);
    g.lineTo(x + 4, y);
    g.fill();
    g.fillStyle = '#0A0A12';
    g.textAlign = 'center';
    g.fillText(text, x, y - h / 2 + 3.6 * pop);
    g.textAlign = 'start';
    g.globalAlpha = 1;
  }

  private drawLogo(g: CanvasRenderingContext2D, f: ArenaView['foods'][number], t: number) {
    const bob = Math.sin(f.phase * 2.2) * 3;
    const s = f.r * 2.5 * (f.sucked > 0 ? 0.85 : 1);
    g.globalCompositeOperation = 'lighter';
    const gs = s * 2.2 * (0.85 + Math.sin(t * 3 + f.phase) * 0.15);
    g.globalAlpha = 0.35;
    g.drawImage(glow('#C6FF3D'), f.x - gs / 2, f.y - gs / 2 + bob, gs, gs);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(shadowSprite, f.x - s * 0.4, f.y + s * 0.45, s * 0.8, s * 0.25);
    g.save();
    g.translate(f.x, f.y + bob);
    g.rotate(Math.sin(f.phase * 1.3) * 0.14 + (f.sucked > 0 ? t * 10 : 0));
    g.drawImage(logoToken(f.logo), -s / 2, -s / 2, s, s);
    g.restore();
  }

  private drawSnake(g: CanvasRenderingContext2D, s: Snake, t: number, hw: number, hh: number) {
    const n = s.xs.length;
    const colors = s.brand.colors;
    const dying = !s.alive;
    const fade = dying ? clamp(1 - (t - s.diedAt) / 0.5, 0, 1) : 1;
    if (fade <= 0) return;
    const cx = this.cam.x;
    const cy = this.cam.y;
    const m = s.r * 3;
    const r = s.r * (dying ? 1 + (1 - fade) * 0.6 : 1);
    const shield = !dying && t - s.bornAt < 1.5;
    const baseA = shield ? 0.55 + 0.35 * Math.sin(t * 30) : fade;
    g.globalAlpha = baseA;

    // Halo de boost : une vague lumineuse qui court le long du corps.
    if (s.boosting && !dying) {
      g.globalCompositeOperation = 'lighter';
      const gl = glow(s.brand.glow);
      for (let i = n - 1; i >= 0; i -= 2) {
        const x = s.xs[i];
        const y = s.ys[i];
        if (Math.abs(x - cx) > hw + m || Math.abs(y - cy) > hh + m) continue;
        const wave = 0.35 + 0.65 * Math.max(0, Math.sin(t * 16 - i * 0.45));
        const size = r * 3.6;
        g.globalAlpha = 0.42 * wave;
        g.drawImage(gl, x - size / 2, y - size / 2, size, size);
      }
      g.globalAlpha = baseA;
      g.globalCompositeOperation = 'source-over';
    }

    // Corps, de la queue vers la tête.
    const gulps = s.gulps;
    for (let i = n - 1; i >= 1; i--) {
      const x = s.xs[i];
      const y = s.ys[i];
      if (Math.abs(x - cx) > hw + m || Math.abs(y - cy) > hh + m) continue;
      const tail = i / n;
      let rr = r * (tail > 0.75 ? 1 - (tail - 0.75) * 1.6 : 1);
      for (let k = 0; k < gulps.length; k++) {
        const p = (t - gulps[k]) * 38;
        const d = i - p;
        if (d > -4 && d < 4) rr *= 1 + 0.28 * (1 - Math.abs(d) / 4);
      }
      const col = colors[((i >> 2) % colors.length)];
      const img = dying ? ball('#FFFFFF') : ball(col);
      g.drawImage(img, x - rr, y - rr, rr * 2, rr * 2);
    }

    // Tête : pastille logo + deux yeux qui regardent où l'on va.
    const hr = r * (1.6 + s.eatPulse * 0.2);
    const ca = Math.cos(s.angle);
    const sa = Math.sin(s.angle);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = fade * (0.35 + s.eatPulse * 0.5);
    const hg = hr * 3.4;
    g.drawImage(glow(s.brand.glow), s.x - hg / 2, s.y - hg / 2, hg, hg);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = fade;
    g.drawImage(headBadge(s.brand.id), s.x - hr, s.y - hr, hr * 2, hr * 2);
    const look = s.wantAngle;
    for (const side of [-1, 1]) {
      const ex = s.x + ca * hr * 0.7 - sa * side * hr * 0.55;
      const ey = s.y + sa * hr * 0.7 + ca * side * hr * 0.55;
      const er = hr * 0.21;
      g.fillStyle = '#0A0A12';
      g.beginPath();
      g.arc(ex, ey, er + 1.5, 0, TAU);
      g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath();
      g.arc(ex, ey, er, 0, TAU);
      g.fill();
      g.fillStyle = '#0A0A12';
      g.beginPath();
      g.arc(ex + Math.cos(look) * er * 0.4, ey + Math.sin(look) * er * 0.4, er * 0.55, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawName(g: CanvasRenderingContext2D, s: Snake) {
    if (!this.onScreen(s.x, s.y, 100)) return;
    const z = this.cam.zoom;
    const size = 12 / z;
    g.font = `600 ${size}px "Space Grotesk", sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(s.name, s.x, s.y - s.r * 1.9 - 10 / z);
    if (s.brand.id === 'jev') {
      // Jev ne discute pas, il affiche sa décision et sa confiance.
      const p = 0.5 + 0.5 * Math.abs(Math.sin(s.wantAngle * 3.7 + s.id));
      g.font = `700 ${10 / z}px "JetBrains Mono", monospace`;
      g.fillStyle = '#FF5FD2';
      g.fillText(`p=${p.toFixed(2)}`, s.x, s.y - s.r * 1.9 - 24 / z);
    }
    g.textAlign = 'start';
  }

  private drawParticles(g: CanvasRenderingContext2D, dt: number, z: number) {
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      ps[w++] = p;
      const k = p.life / p.max;
      if (p.kind === 0) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = k;
        const s = p.size * 4 * (0.4 + k * 0.6);
        g.drawImage(glow(p.color), p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.kind === 1) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = k * 0.9;
        g.strokeStyle = p.color;
        g.lineWidth = 4 * k + 1;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (1.3 - k), 0, TAU);
        g.stroke();
      } else {
        p.y += p.vy * dt;
        p.vy *= 1 - dt * 2.5;
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = Math.min(1, k * 2.5);
        const pop = 1 + Math.max(0, (k - 0.85) * 4);
        g.font = `900 ${(p.size / Math.max(z, 0.5)) * pop}px Unbounded, sans-serif`;
        g.textAlign = 'center';
        g.lineWidth = 5 / z;
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.strokeText(p.text!, p.x, p.y);
        g.fillStyle = p.color;
        g.fillText(p.text!, p.x, p.y);
        g.textAlign = 'start';
      }
    }
    ps.length = w;
    if (ps.length > 1500) ps.splice(0, ps.length - 1500);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawSpeedLines(g: CanvasRenderingContext2D) {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const diag = Math.hypot(cx, cy);
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,255,255,${0.16 * this.boostLines})`;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU;
      const r0 = diag * rand(0.45, 0.75);
      const r1 = r0 + diag * rand(0.08, 0.25);
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  }

  /** Teinte de fond pour l'aura de couleur derrière l'interface. */
  static tint(color: string, a: number) {
    return rgba(color, a);
  }
}
