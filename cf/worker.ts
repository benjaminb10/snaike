// Serveur multijoueur sur Cloudflare (plan gratuit) : le client reste sur Vercel, ce Worker sert /ws et /api.
// - Chaque arène est un Durable Object (ROOM « arena-N ») : il garde la World en mémoire et tourne
//   seulement tant que quelqu'un est connecté.
// - L'API sponsors vit dans un Durable Object unique (SPONSORS), qui stocke campagnes et compteurs.
import { DurableObject } from 'cloudflare:workers';
import { Room, fixedLoop } from '../server/room';
import { SponsorApi, type ApiEnv } from '../server/sponsors';

interface Env extends ApiEnv {
  ROOM: DurableObjectNamespace<RoomObject>;
  SPONSORS: DurableObjectNamespace<SponsorsObject>;
}

const MAX_ROOMS = 8;
const FULL = 409;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      // Première arène qui a de la place (elles se remplissent dans l'ordre).
      for (let i = 0; i < MAX_ROOMS; i++) {
        const res = await env.ROOM.get(env.ROOM.idFromName(`arena-${i}`)).fetch(req);
        if (res.status !== FULL) return res;
      }
      return new Response('all arenas full', { status: 503 });
    }

    if (url.pathname.startsWith('/api/')) {
      return env.SPONSORS.get(env.SPONSORS.idFromName('main')).fetch(req);
    }

    if (url.pathname === '/healthz') return Response.json({ ok: true });
    return Response.redirect(env.PUBLIC_URL || 'https://playsnaike.vercel.app', 302);
  },
} satisfies ExportedHandler<Env>;

// ---------- Arène ----------

export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;
  private stop: (() => void) | null = null;

  fetch(): Response {
    if (this.room?.full) return new Response('full', { status: FULL });
    const room = (this.room ??= new Room(Number(this.ctx.id.name?.split('-')[1] ?? 0) + 1));

    const [client, server] = Object.values(new WebSocketPair());
    // Binaire en ArrayBuffer (le défaut standard des versions récentes est Blob).
    server.binaryType = 'arraybuffer';
    server.accept();
    let open = true;
    const c = room.connect({
      send: (d) => {
        try {
          server.send(d);
        } catch {
          open = false;
        }
      },
      ready: () => open,
    });
    server.addEventListener('message', (e) => {
      const d = e.data;
      if (typeof d === 'string' ? d.length > 1024 : d.byteLength > 1024) return;
      room.message(c, d);
    });
    const close = () => {
      open = false;
      room.leave(c);
      if (room.clients.size === 0) this.idle();
    };
    server.addEventListener('close', close);
    server.addEventListener('error', close);

    this.stop ??= fixedLoop(() => room.tick());
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Plus personne : on arrête la boucle, l'objet peut s'endormir (et ne coûte plus rien). */
  private idle() {
    this.stop?.();
    this.stop = null;
  }
}

// ---------- Sponsors ----------

export class SponsorsObject extends DurableObject<Env> {
  private api: SponsorApi;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const storage = ctx.storage;
    this.api = new SponsorApi(env, {
      load: <T>(key: string) => storage.get<T>(key),
      save: (key, value) => storage.put(key, value),
    });
  }

  async fetch(req: Request): Promise<Response> {
    const ip = req.headers.get('cf-connecting-ip') ?? '';
    const res = (await this.api.handle(req, ip)) ?? new Response('not found', { status: 404 });
    // Compteurs écrits au plus toutes les 30 s (limite d'écritures du plan gratuit).
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    return res;
  }

  async alarm() {
    await this.api.flush();
  }
}
