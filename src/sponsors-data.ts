// Données sponsors partagées par le client et le serveur (pas de DOM ici).

export interface Sponsor {
  id: string;
  name: string;
  tagline: string;
  url: string;
  color: string;
  /** Chemin relatif (logo maison dans public/) ou adresse https. */
  logo: string;
  /** 1 bandeau du menu · 2 + carte de fin · 3 + panneau géant dans l'arène. */
  tier: number;
}

export const SPONSORS: Sponsor[] = [
  { id: 'bereach', name: 'BeReach', tagline: 'The AI agent that does your LinkedIn outreach', url: 'https://bereach.ai/', color: '#3b6cf6', logo: 'sponsors/bereach.png', tier: 3 },
  { id: 'viewlify', name: 'Viewlify', tagline: 'Analyze any TikTok account, for free', url: 'https://viewlify.app/', color: '#ff7a5c', logo: 'sponsors/viewlify.png', tier: 3 },
  { id: 'postroyalty', name: 'PostRoyalty', tagline: 'Creators film your product, you pay per view', url: 'https://www.postroyalty.com/', color: '#ff2d55', logo: 'sponsors/postroyalty.png', tier: 3 },
];

/** Offres de la page Advertise (le paiement passe par /api/checkout?tier=N côté serveur). */
export interface Tier {
  tier: number;
  name: string;
  price: string;
  perks: string[];
}

export const SPONSOR_DAYS = 30;

export const TIERS: Tier[] = [
  { tier: 1, name: 'Menu', price: '$19', perks: ['Your logo and name in the menu rail', 'Seen by every player before each game', 'Click and view stats'] },
  { tier: 2, name: 'Sponsor', price: '$49', perks: ['Everything in Menu', 'Your card on the game over screen', 'Shown after every death, with a TRY IT button'] },
  { tier: 3, name: 'Gold', price: '$99', perks: ['Everything in Sponsor', 'Your logo giant in the center of the arena', 'Shown twice as often on the game over screen'] },
];
