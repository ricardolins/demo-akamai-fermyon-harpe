interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  delivery_time_min: number;
  delivery_fee: number;
  min_order: number;
  region: string;
  active: boolean;
  image_url: string;
  tags: string[];
}

const HARPER_URL = process.env.HARPER_URL ?? "http://localhost:9925";
const HARPER_AUTH = `Basic ${btoa(
  `${process.env.HARPER_USER ?? "HDB_ADMIN"}:${process.env.HARPER_PASS ?? "password"}`
)}`;

async function queryHarper<T>(sql: string): Promise<T[]> {
  const res = await fetch(`${HARPER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: HARPER_AUTH },
    body: JSON.stringify({ operation: "sql", sql }),
  });
  return res.json();
}

export async function handleMenu(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") ?? "sa-east-1";
  const cuisine = url.searchParams.get("cuisine");

  let sql = `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`;
  if (cuisine) sql += ` AND cuisine = '${cuisine}'`;
  sql += " ORDER BY rating DESC";

  let restaurants: Restaurant[];
  try {
    restaurants = await queryHarper<Restaurant>(sql);
  } catch {
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(restaurants), {
    headers: {
      "Content-Type": "application/json",
      // CDN cacheia por 5 minutos, varia por região
      "Cache-Control": "public, max-age=300",
      "X-Edge-Region": region,
    },
  });
}
