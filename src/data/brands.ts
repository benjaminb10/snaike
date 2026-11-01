import catalog from './catalog.json';

export interface Brand {
  id: string;
  name: string;
  maker: string;
  colors: string[];
  glow: string;
  models: string[];
}

export interface Victim {
  id: string;
  name: string;
  epitaph: string;
}

export const BRANDS: Brand[] = catalog.snakes.map(({ src: _src, ...b }) => b);
export const VICTIMS: Victim[] = catalog.victims.map(({ src: _src, ...v }) => v);
export const brandById = (id: string) => BRANDS.find((b) => b.id === id) ?? BRANDS[0];

export const logoUrl = (id: string) => `${import.meta.env.BASE_URL}logos/${id}.svg`;
