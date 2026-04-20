import { AutoRouter } from 'itty-router';

declare const __HARPER_URL__: string;
declare const __HARPER_USER__: string;
declare const __HARPER_PASS__: string;

const ALLOWED_IPS = [
  '177.181.2.218',
  '2804:14d:783a:815a:f5fd:666c:7d67:b0ff',
];

let router = AutoRouter({
  before: [(req): Response | undefined => {
    const ip = req.headers.get('true-client-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? '';
    if (!ALLOWED_IPS.includes(ip)) {
      return new Response('Forbidden', { status: 403 });
    }
    return undefined;
  }],
});

function getHarperAuth(): { url: string; auth: string } {
  return {
    url: __HARPER_URL__,
    auth: `Basic ${btoa(`${__HARPER_USER__}:${__HARPER_PASS__}`)}`,
  };
}

async function queryHarper<T>(sql: string): Promise<T[]> {
  const { url, auth } = getHarperAuth();
  const res = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ operation: 'sql', sql }),
  });
  if (!res.ok) throw new Error(`Harper ${res.status}`);
  return res.json();
}

async function insertHarper(table: string, record: object): Promise<void> {
  const { url, auth } = getHarperAuth();
  const res = await fetch(`${url}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ operation: 'insert', schema: 'foodedge', table, records: [record] }),
  });
  if (!res.ok) throw new Error(`Harper insert ${res.status}`);
}

function edgeRegion(req: Request): string {
  // Headers injetados pela Akamai Functions com a região do PoP
  return req.headers.get('x-aka-region')
    ?? req.headers.get('fly-region')
    ?? req.headers.get('x-vercel-id')?.split(':')[0]
    ?? 'edge';
}

function json(data: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Rotas ---

router.get('/api/menu', async (req) => {
  const url = new URL(req.url);
  const region = url.searchParams.get('region') ?? 'sa-east-1';
  const cuisine = url.searchParams.get('cuisine');
  let sql = `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`;
  if (cuisine) sql += ` AND cuisine = '${cuisine}'`;
  sql += ' ORDER BY rating DESC';
  try {
    const data = await queryHarper(sql);
    return json(data, 200, { 'Cache-Control': 'public, max-age=300', 'X-Edge-Region': region });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

router.get('/api/menu-items', async (req) => {
  const url = new URL(req.url);
  const restaurantId = url.searchParams.get('restaurant_id');
  if (!restaurantId) return json({ error: 'restaurant_id required' }, 400);
  try {
    const data = await queryHarper(
      `SELECT * FROM foodedge.menu_items WHERE restaurant_id = '${restaurantId}' AND available = true ORDER BY category`
    );
    return json(data, 200, { 'Cache-Control': 'public, max-age=120' });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

router.get('/api/personalization', async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get('user_id');
  const region = url.searchParams.get('region') ?? 'sa-east-1';
  try {
    const [restaurants, users] = await Promise.all([
      queryHarper<any>(`SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`),
      userId ? queryHarper<any>(`SELECT * FROM foodedge.users WHERE id = '${userId}' LIMIT 1`) : Promise.resolve([]),
    ]);
    const user = users[0];
    const pop = edgeRegion(req);
    if (!user) {
      return json(restaurants.sort((a: any, b: any) => b.rating - a.rating), 200, { 'Cache-Control': 'public, max-age=300', 'X-Edge-Region': pop });
    }
    const ranked = restaurants
      .map((r: any) => {
        let score = r.rating;
        score += (user.order_history ?? []).filter((id: string) => id === r.id).length;
        score += (r.tags ?? []).filter((t: string) => (user.preferences ?? []).includes(t)).length * 0.5;
        return { ...r, _score: score };
      })
      .sort((a: any, b: any) => b._score - a._score)
      .map(({ _score, ...r }: any) => r);
    return json(ranked, 200, { 'Cache-Control': 'private, no-store', 'X-Edge-Region': pop });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

router.get('/api/geo', async (req) => {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get('lat') ?? '0');
  const lon = parseFloat(url.searchParams.get('lon') ?? '0');
  const radius = parseFloat(url.searchParams.get('radius') ?? '5');
  try {
    const restaurants = await queryHarper<any>('SELECT * FROM foodedge.restaurants WHERE active = true');
    const nearby = restaurants
      .map((r: any) => {
        const dist = haversineKm(lat, lon, r.location.lat, r.location.lon);
        return { ...r, distance_km: Math.round(dist * 10) / 10, estimated_delivery_min: Math.round(r.delivery_time_min + Math.max(0, dist - 2) * 5) };
      })
      .filter((r: any) => r.distance_km <= radius)
      .sort((a: any, b: any) => a.distance_km - b.distance_km);
    return json(nearby, 200, { 'Cache-Control': 'public, max-age=120' });
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

router.get('/api/orders/:id', async (req) => {
  const id = (req as any).params.id;
  try {
    const rows = await queryHarper<any>(`SELECT * FROM foodedge.orders WHERE id = '${id}' LIMIT 1`);
    if (!rows.length) return new Response('Not found', { status: 404 });
    return json(rows[0]);
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

router.post('/api/orders', async (req) => {
  try {
    const body = await req.json() as any;
    const total = (body.items ?? []).reduce((s: number, i: any) => s + i.price * i.quantity, 0);
    const now = Date.now();
    const order = {
      id: crypto.randomUUID(),
      ...body,
      status: 'confirmed',
      total,
      created_at: now,
      estimated_delivery_at: now + 30 * 60 * 1000,
    };
    await insertHarper('orders', order);
    return json(order, 201);
  } catch {
    return json({ error: 'HarperDB unavailable' }, 503);
  }
});

// @ts-ignore
addEventListener('fetch', (event: FetchEvent) => {
  event.respondWith(router.fetch(event.request));
});
