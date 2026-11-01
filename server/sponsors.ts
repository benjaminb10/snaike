// Sponsors côté serveur : liste (maison + payants), comptage des vues et clics, paiement et webhook Stripe.
// Écrit en standards web (Request/Response, Web Crypto) : tourne sur Node comme sur Cloudflare.
// Le stockage est fourni par l'hôte (fichiers JSON sur Node, stockage du Durable Object sur Cloudflare).
import { SPONSORS as HOUSE, type Sponsor } from '../src/sponsors-data';

export interface ApiEnv {
  SPONSOR_SECRET?: string;
  ADMIN_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  PUBLIC_URL?: string;
  SPONSOR_DAYS?: string;
}

export interface Store {
  load<T>(key: string): Promise<T | undefined>;
  save(key: string, value: unknown): Promise<void>;
}

interface Paid extends Sponsor {
  until: number; // fin de la campagne (ms)
  email: string | null;
  session: string;
  created: number;
}

// stats[id][jour][emplacement] = [vues, clics]
type Stats = Record<string, Record<string, Record<string, [number, number]>>>;

interface StripeSession {
  id: string;
  payment_status: string;
  amount_total: number | null;
  metadata?: Record<string, string>;
  custom_fields?: { key: string; text?: { value: string | null } }[];
  customer_details?: { email?: string | null };
}

const TIER_CENTS: Record<number, number> = { 1: 1900, 2: 4900, 3: 9900 };
const TIER_NAMES: Record<number, string> = { 1: 'Menu', 2: 'Sponsor', 3: 'Gold' };
const PLACEMENTS = new Set(['menu', 'death', 'arena', 'advertise']);
const CORS = { 'access-control-allow-origin': '*' };

const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });

const enc = new TextEncoder();
async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison à temps constant. */
function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'brand';
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

function normUrl(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export class SponsorApi {
  private paid: Paid[] = [];
  private stats: Stats = {};
  private ready: Promise<void>;
  private dirty = false;
  private hits = new Map<string, number>();
  private hitsAt = Date.now();
  private readonly secret: string;
  private readonly days: number;

  constructor(private env: ApiEnv, private store: Store) {
    this.secret = env.SPONSOR_SECRET || 'dev-secret';
    this.days = Number(env.SPONSOR_DAYS ?? 30);
    this.ready = (async () => {
      this.paid = (await store.load<Paid[]>('sponsors')) ?? [];
      this.stats = (await store.load<Stats>('stats')) ?? {};
    })();
  }

  statsKey = async (id: string) => (await hmacHex(this.secret, id)).slice(0, 24);

  /** Écrit les compteurs s'ils ont changé (appelé périodiquement par l'hôte). */
  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    await this.store.save('stats', this.stats);
  }

  private active(): Sponsor[] {
    const now = Date.now();
    const live = this.paid.filter((p) => p.until > now).map(({ id, name, tagline, url, color, logo, tier }) => ({ id, name, tagline, url, color, logo, tier }));
    return [...live, ...HOUSE];
  }

  private record(id: string, placement: string, click: boolean) {
    const day = new Date().toISOString().slice(0, 10);
    const byDay = (this.stats[id] ??= {});
    const byPlace = (byDay[day] ??= {});
    const c = (byPlace[placement] ??= [0, 0]);
    c[click ? 1 : 0]++;
    this.dirty = true;
  }

  private summary(id: string) {
    const days = this.stats[id] ?? {};
    let views = 0;
    let clicks = 0;
    const byPlacement: Record<string, [number, number]> = {};
    for (const d of Object.values(days)) {
      for (const [p, [v, c]] of Object.entries(d)) {
        views += v;
        clicks += c;
        const t = (byPlacement[p] ??= [0, 0]);
        t[0] += v;
        t[1] += c;
      }
    }
    return { id, views, clicks, byPlacement, days };
  }

  private async verifyStripe(body: string, header: string | null) {
    const secret = this.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !header) return false;
    const parts = header.split(',');
    const t = parts.find((p) => p.startsWith('t='))?.slice(2);
    const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
    const mac = await hmacHex(secret, `${t}.${body}`);
    return sigs.some((s) => eq(s, mac));
  }

  private async addFromSession(s: StripeSession): Promise<Paid | null> {
    const existing = this.paid.find((p) => p.session === s.id);
    if (existing) return existing;
    const field = (k: string) => s.custom_fields?.find((f) => f.key === k)?.text?.value ?? '';
    const name = clean(field('brand'), 24);
    const url = normUrl(clean(field('website'), 200));
    if (!name || !url) return null;
    const tierMeta = Number(s.metadata?.tier);
    const cents = s.amount_total ?? 0;
    const tier = tierMeta >= 1 && tierMeta <= 3 ? tierMeta : cents >= 9900 ? 3 : cents >= 4900 ? 2 : 1;
    let id = slug(name);
    while (this.paid.some((p) => p.id === id) || HOUSE.some((h) => h.id === id)) id += '-' + Math.floor(Math.random() * 90 + 10);
    const host = new URL(url).hostname;
    const p: Paid = {
      id, name, url, tier,
      tagline: clean(field('tagline'), 60) || host,
      color: '#c6ff3d',
      logo: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      until: Date.now() + this.days * 86_400_000,
      email: s.customer_details?.email ?? null,
      session: s.id,
      created: Date.now(),
    };
    this.paid.push(p);
    await this.store.save('sponsors', this.paid);
    console.log(`[sponsor] added ${p.name} (tier ${p.tier}, ${p.url})`);
    return p;
  }

  private async stripe(path: string, body?: URLSearchParams) {
    const r = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body,
    });
    const data = (await r.json()) as Record<string, unknown> & { error?: { message: string } };
    if (!r.ok) throw new Error(data.error?.message ?? `stripe ${r.status}`);
    return data;
  }

  /** Session Stripe Checkout pour une offre, à l'habillage du jeu (le compte porte celui d'un autre produit). */
  private async checkout(origin: string, tier: number) {
    const days = this.days;
    const body = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(TIER_CENTS[tier]),
      'line_items[0][price_data][product_data][name]': `SNAIKE ${TIER_NAMES[tier]} sponsor, ${days} days`,
      success_url: `${origin}/advertise.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/advertise.html`,
      locale: 'en',
      billing_address_collection: 'auto',
      allow_promotion_codes: 'true',
      'invoice_creation[enabled]': 'true',
      'payment_intent_data[statement_descriptor_suffix]': 'SNAIKE',
      'metadata[product]': 'snaike-sponsor',
      'metadata[tier]': String(tier),
      'custom_fields[0][key]': 'brand',
      'custom_fields[0][label][type]': 'custom',
      'custom_fields[0][label][custom]': 'Brand name',
      'custom_fields[0][type]': 'text',
      'custom_fields[0][text][maximum_length]': '24',
      'custom_fields[1][key]': 'website',
      'custom_fields[1][label][type]': 'custom',
      'custom_fields[1][label][custom]': 'Website (example.com)',
      'custom_fields[1][type]': 'text',
      'custom_fields[1][text][maximum_length]': '200',
      'custom_fields[2][key]': 'tagline',
      'custom_fields[2][label][type]': 'custom',
      'custom_fields[2][label][custom]': 'Tagline, shown under your logo',
      'custom_fields[2][type]': 'text',
      'custom_fields[2][optional]': 'true',
      'custom_fields[2][text][maximum_length]': '60',
      'custom_text[submit][message]': `Your brand goes live in SNAIKE right after payment, for ${days} days.`,
      'branding_settings[display_name]': 'SNAIKE',
      'branding_settings[background_color]': '#07070d',
      'branding_settings[button_color]': '#c6ff3d',
      'branding_settings[border_style]': 'rounded',
      'branding_settings[font_family]': 'montserrat',
      'branding_settings[icon][type]': 'url',
      'branding_settings[icon][url]': `${origin}/stripe-icon.png`,
    });
    const s = await this.stripe('checkout/sessions', body);
    return String(s.url);
  }

  /** Routes /api/… ; renvoie null si la requête n'est pas pour nous. `ip` sert à limiter les événements. */
  async handle(req: Request, ip = ''): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return null;
    await this.ready;
    // Site public (page Advertise) : PUBLIC_URL, sinon l'origine de la requête.
    const origin = (this.env.PUBLIC_URL || url.origin).replace(/\/$/, '');

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' } });
    }

    if (path === '/api/checkout' && req.method === 'GET') {
      const tier = Number(url.searchParams.get('tier'));
      if (!this.env.STRIPE_SECRET_KEY || !TIER_CENTS[tier]) return redirect(`${origin}/advertise.html?error=checkout`);
      try {
        return redirect(await this.checkout(origin, tier));
      } catch (e) {
        console.error('[checkout]', e);
        return redirect(`${origin}/advertise.html?error=checkout`);
      }
    }

    if (path === '/api/sponsors' && req.method === 'GET') return json(200, this.active());

    // Vue ou clic, envoyé en sendBeacon (texte brut) : {"e":"v"|"c","id":"…","p":"menu"}
    if (path === '/api/sponsor-event' && req.method === 'POST') {
      if (Date.now() - this.hitsAt > 60_000) {
        this.hits.clear();
        this.hitsAt = Date.now();
      }
      const n = (this.hits.get(ip) ?? 0) + 1; // limite par IP : 240 événements par minute
      this.hits.set(ip, n);
      try {
        const text = await req.text();
        if (text.length <= 2048) {
          const m = JSON.parse(text) as { e?: string; id?: string; p?: string };
          const known = this.active().some((s) => s.id === m.id);
          if (n <= 240 && known && PLACEMENTS.has(String(m.p)) && (m.e === 'v' || m.e === 'c')) this.record(String(m.id), String(m.p), m.e === 'c');
        }
      } catch {
        /* ignoré */
      }
      return new Response(null, { status: 204, headers: CORS });
    }

    // Chiffres d'un sponsor (lien privé avec clé), ou de tous avec la clé admin.
    if (path === '/api/sponsor-stats' && req.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const key = url.searchParams.get('key') ?? '';
      const admin = this.env.ADMIN_KEY;
      if (!id && admin && eq(key, admin)) return json(200, Object.keys(this.stats).map((i) => this.summary(i)));
      if (!id || !eq(key, await this.statsKey(id))) return json(403, { error: 'bad key' });
      const s = this.active().find((x) => x.id === id) ?? this.paid.find((x) => x.id === id);
      const p = this.paid.find((x) => x.id === id);
      return json(200, { ...this.summary(id), name: s?.name ?? id, until: p?.until ?? null, tier: s?.tier ?? null });
    }

    // Totaux publics pour la page Advertise (30 derniers jours, tous emplacements).
    if (path === '/api/reach' && req.method === 'GET') {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      let views = 0;
      let clicks = 0;
      for (const days of Object.values(this.stats)) {
        for (const [d, places] of Object.entries(days)) {
          if (d < since) continue;
          for (const [v, c] of Object.values(places)) {
            views += v;
            clicks += c;
          }
        }
      }
      return json(200, { views, clicks, sponsors: this.active().length });
    }

    // Après paiement : la page de remerciement retrouve la campagne et son lien de stats.
    if (path === '/api/sponsor-by-session' && req.method === 'GET') {
      const sid = url.searchParams.get('session') ?? '';
      const valid = /^cs_[A-Za-z0-9_]+$/.test(sid);
      let p = valid ? this.paid.find((x) => x.session === sid) : undefined;
      // Pas encore de webhook : on demande directement à Stripe si la session est payée.
      if (!p && valid && this.env.STRIPE_SECRET_KEY) {
        try {
          const s = (await this.stripe(`checkout/sessions/${sid}`)) as unknown as StripeSession;
          if (s.payment_status === 'paid' && s.metadata?.product === 'snaike-sponsor') p = (await this.addFromSession(s)) ?? undefined;
        } catch (e) {
          console.error('[session]', e);
        }
      }
      if (!p) return json(404, { pending: true });
      return json(200, { id: p.id, name: p.name, tier: p.tier, until: p.until, key: await this.statsKey(p.id) });
    }

    if (path === '/api/stripe-webhook' && req.method === 'POST') {
      const body = await req.text();
      if (body.length > 512 * 1024 || !(await this.verifyStripe(body, req.headers.get('stripe-signature')))) return json(400, { error: 'bad signature' });
      const event = JSON.parse(body) as { type: string; data: { object: StripeSession } };
      const o = event.data.object;
      if (event.type !== 'checkout.session.completed' || o.payment_status !== 'paid' || o.metadata?.product !== 'snaike-sponsor') {
        return json(200, { ok: true, skipped: event.type });
      }
      const p = await this.addFromSession(o);
      // Champs invalides : la vente reste visible dans Stripe pour un ajout à la main.
      return json(200, { ok: true, added: p?.id ?? null });
    }

    return json(404, { error: 'not found' });
  }
}
