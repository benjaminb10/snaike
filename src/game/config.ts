// Réglages du jeu. Tout est en pixels "monde" et en secondes.
export const WORLD_R = 3300;

export const BASE_SPEED = 235;
export const BOOST_SPEED = 500;
export const START_MASS = 26;
export const MIN_BOOST_MASS = 18;
export const BOOST_COST = 11; // masse perdue par seconde de boost

export const HUMAN_COUNT = 2300;
export const ORB_COUNT = 1300;
export const LOGO_COUNT = 120;
export const DROP_CAP = 4000; // orbes lâchés (morts + boost), hors orbes d'ambiance
export const BOT_COUNT = 20;
export const BOT_MASS_SOFT_CAP = 900; // au-delà, un bot perd peu à peu sa masse en trop

export const HUMAN_VALUE = 1.1;
export const LOGO_VALUE = 9;

export const radiusOf = (m: number) => Math.min(8.5 + Math.sqrt(m) * 1.05, 48);
export const segmentsOf = (m: number) => Math.floor(14 + Math.pow(m, 0.72) * 1.1);
export const spacingOf = (r: number) => r * 0.44;
// Enroulement : tourner à fond dans le même sens permet de serrer de plus en plus (jusqu'à x1,8
// après 1,5 tour), pour étouffer un serpent encerclé. Retombe en ~1 s quand on redresse.
export const COIL_BONUS = 0.8;
export const COIL_TURNS = 1.5;
export const turnRateOf = (m: number) => 2.2 + 3.4 / (1 + m / 320);
export const scoreOf = (m: number) => Math.round(m * 10);
