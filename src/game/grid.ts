import { WORLD_R } from './config';

/**
 * Grille spatiale fixe couvrant l'arène. Reconstruite à chaque frame :
 * les tableaux de cellules sont réutilisés pour ne rien allouer.
 */
export class Grid<T> {
  readonly cell: number;
  readonly cols: number;
  private cells: T[][];
  private used: number[] = [];

  constructor(cell: number) {
    this.cell = cell;
    this.cols = Math.ceil((WORLD_R * 2 + cell * 4) / cell);
    this.cells = Array.from({ length: this.cols * this.cols }, () => []);
  }

  private key(x: number, y: number) {
    const cx = Math.floor((x + WORLD_R) / this.cell) + 2;
    const cy = Math.floor((y + WORLD_R) / this.cell) + 2;
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.cols) return -1;
    return cy * this.cols + cx;
  }

  clear() {
    for (const k of this.used) this.cells[k].length = 0;
    this.used.length = 0;
  }

  insert(x: number, y: number, v: T) {
    const k = this.key(x, y);
    if (k < 0) return;
    const c = this.cells[k];
    if (c.length === 0) this.used.push(k);
    c.push(v);
  }

  /** Appelle fn pour chaque élément des cellules touchant le carré (x±r, y±r). */
  query(x: number, y: number, r: number, fn: (v: T) => void) {
    const c0 = Math.max(0, Math.floor((x - r + WORLD_R) / this.cell) + 2);
    const c1 = Math.min(this.cols - 1, Math.floor((x + r + WORLD_R) / this.cell) + 2);
    const r0 = Math.max(0, Math.floor((y - r + WORLD_R) / this.cell) + 2);
    const r1 = Math.min(this.cols - 1, Math.floor((y + r + WORLD_R) / this.cell) + 2);
    for (let cy = r0; cy <= r1; cy++) {
      const row = cy * this.cols;
      for (let cx = c0; cx <= c1; cx++) {
        const c = this.cells[row + cx];
        for (let i = 0; i < c.length; i++) fn(c[i]);
      }
    }
  }
}
