import { sfx } from './audio';

// Têtes qui surgissent du coin de l'écran avec un cri, façon "Toasty!" de Mortal Kombat.
// Portraits libres de Wikimedia Commons (voir public/heads/CREDITS.md).

export interface Face {
  id: string;
  name: string;
}

const FACES: Record<string, Face> = {
  altman: { id: 'altman', name: 'Sam Altman' },
  musk: { id: 'musk', name: 'Elon Musk' },
  amodei: { id: 'amodei', name: 'Dario Amodei' },
  hassabis: { id: 'hassabis', name: 'Demis Hassabis' },
  pichai: { id: 'pichai', name: 'Sundar Pichai' },
  zuckerberg: { id: 'zuckerberg', name: 'Mark Zuckerberg' },
  huang: { id: 'huang', name: 'Jensen Huang' },
  nadella: { id: 'nadella', name: 'Satya Nadella' },
};

/** Le patron associé à chaque IA (Jensen Huang gagne quoi qu'il arrive : il vend les GPU). */
const BY_BRAND: Record<string, string[]> = {
  claude: ['amodei'],
  chatgpt: ['altman'],
  gemini: ['pichai', 'hassabis'],
  grok: ['musk'],
  meta: ['zuckerberg'],
  mistral: ['huang'],
  deepseek: ['huang'],
  perplexity: ['nadella', 'huang'],
};

export const faceFor = (brandId: string) => {
  const list = BY_BRAND[brandId] ?? ['huang'];
  return FACES[list[Math.floor(Math.random() * list.length)]];
};
export const face = (id: keyof typeof FACES | string) => FACES[id] ?? FACES.huang;
export const randomFace = () => {
  const all = Object.values(FACES);
  return all[Math.floor(Math.random() * all.length)];
};

export const SHOUT = {
  kill: ['WOOHOO!', 'TOASTY!', 'DISRUPTED!', 'SHIP IT!', 'SCALING!'],
  death: ['TOO EASY!', 'GG!', 'NEXT!', 'SKILL ISSUE!'],
  logo: ['ACQUIRED!', 'DISRUPTED!', 'WE BUY IT!'],
  top: ['AGI ACHIEVED!', 'NUMBER ONE!'],
  combo: ['MORE GPUS!', 'BUY MORE GPUS!'],
};
export const pickShout = (k: keyof typeof SHOUT) => SHOUT[k][Math.floor(Math.random() * SHOUT[k].length)];

const box = document.getElementById('pop')!;
const img = box.querySelector('img')!;
const say = box.querySelector('.pop-say')!;
const tag = box.querySelector('.pop-name')!;
let busyUntil = 0;
let lastAt = 0;
let voice: SpeechSynthesisVoice | null = null;

function speak(text: string) {
  if (sfx.muted || !('speechSynthesis' in window)) return;
  try {
    if (!voice) voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en')) ?? null;
    const u = new SpeechSynthesisUtterance(text.replace(/!/g, ''));
    if (voice) u.voice = voice;
    u.pitch = 1.9;
    u.rate = 1.2;
    u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* synthèse vocale indisponible */
  }
}

/**
 * Fait surgir une tête. `force` passe outre le délai minimal entre deux apparitions
 * (utilisé pour les kills et la mort du joueur).
 */
export function pop(f: Face, text: string, force = false) {
  const now = performance.now();
  if (now < busyUntil || (!force && now - lastAt < 7000)) return;
  lastAt = now;
  busyUntil = now + 1500;
  img.src = `${import.meta.env.BASE_URL}heads/${f.id}.png`;
  say.textContent = text;
  tag.textContent = f.name;
  box.classList.remove('on');
  void box.offsetWidth;
  box.classList.add('on');
  speak(text);
}

export function resetPop() {
  box.classList.remove('on');
  busyUntil = 0;
  lastAt = 0;
}
