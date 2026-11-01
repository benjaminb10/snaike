// Serveur multijoueur Node : sert le jeu (dist/), l'API sponsors, et fait tourner les arènes en WebSocket.
// (En production, la version Cloudflare est dans cf/worker.ts ; celle-ci sert au dev et à Fly/Docker.)
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { BRANDS } from '../src/data/brands';
import { Room, fixedLoop } from './room';
import { SponsorApi, type Store } from './sponsors';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC = resolve(process.env.STATIC_DIR ?? 'dist');
const DATA = process.env.DATA_DIR ?? 'data';

// ---------- Sponsors (fichiers JSON dans DATA_DIR) ----------

mkdirSync(DATA, { recursive: true });
const fileStore: Store = {
  async load<T>(key: string) {
    try {
      return JSON.parse(readFileSync(join(DATA, `${key}.json`), 'utf8')) as T;
    } catch {
      return undefined;
    }
  },
  async save(key, value) {
    const p = join(DATA, `${key}.json`);
    writeFileSync(p + '.tmp', JSON.stringify(value));
    renameSync(p + '.tmp', p); // écriture atomique
  },
};
const api = new SponsorApi(process.env, fileStore);
setInterval(() => void api.flush(), 30_000).unref();
process.on('SIGTERM', () => {
  void api.flush().finally(() => process.exit(0));
});

/** Passe une requête Node à l'API (standards web) et recopie la réponse. */
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > 512 * 1024) break;
    chunks.push(c);
  }
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host);
  const r = new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const out = await api.handle(r, ip);
  if (!out) return false;
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
  return true;
}

// ---------- Arènes ----------

const rooms: Room[] = [];
let nextRoomId = 1;

function roomFor(): Room {
  // Remplit d'abord l'arène la plus peuplée qui a encore de la place.
  let best: Room | null = null;
  for (const r of rooms) if (!r.full && (!best || r.clients.size > best.clients.size)) best = r;
  if (best) return best;
  const r = new Room(nextRoomId++);
  rooms.push(r);
  console.log(`[room ${r.id}] created (${rooms.length} total)`);
  return r;
}

roomFor(); // une arène toujours chaude

fixedLoop(() => {
  for (const r of rooms) r.tick();
  // Arènes vides depuis 60 s fermées (on garde la première).
  for (let i = rooms.length - 1; i > 0; i--) {
    const r = rooms[i];
    if (r.clients.size === 0 && Date.now() - r.emptySince > 60_000) {
      rooms.splice(i, 1);
      console.log(`[room ${r.id}] closed`);
    }
  }
});

// ---------- HTTP + WebSocket ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (await handleApi(req, res, url)) return;
  } catch (e) {
    console.error('[api]', e);
    if (!res.headersSent) res.writeHead(500).end();
    return;
  }
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.map((r) => ({ id: r.id, clients: r.clients.size, players: r.players })) }));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC, path);
  if (!file.startsWith(STATIC) || !existsSync(file) || !statSync(file).isFile()) file = join(STATIC, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${STATIC}/assets/`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  const room = roomFor();
  const c = room.connect({
    send: (d) => ws.send(d),
    ready: () => ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 512 * 1024,
  });
  ws.on('message', (data, isBinary) => room.message(c, isBinary ? (data as Buffer) : String(data)));
  ws.on('close', () => room.leave(c));
  ws.on('error', () => ws.terminate());
});

http.listen(PORT, () => console.log(`SNAIKE server on :${PORT} (static: ${STATIC}, ${BRANDS.length} AIs)`));
