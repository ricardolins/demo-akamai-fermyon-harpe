interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  tags: string[];
  [key: string]: unknown;
}

interface User {
  id: string;
  preferences: string[];
  order_history: string[]; // lista de restaurant_ids já pedidos
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

function scoreRestaurant(restaurant: Restaurant, user: User): number {
  let score = restaurant.rating;

  // +1 por cada pedido anterior neste restaurante
  const orderCount = user.order_history.filter((id) => id === restaurant.id).length;
  score += orderCount;

  // +0.5 por cada tag que bate com preferências do usuário
  const tagMatches = restaurant.tags.filter((tag) => user.preferences.includes(tag)).length;
  score += tagMatches * 0.5;

  return score;
}

export async function handlePersonalization(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  const region = url.searchParams.get("region") ?? "sa-east-1";

  let restaurants: Restaurant[], users: User[];
  try {
    [restaurants, users] = await Promise.all([
      queryHarper<Restaurant>(
        `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`
      ),
      userId
        ? queryHarper<User>(`SELECT * FROM foodedge.users WHERE id = '${userId}' LIMIT 1`)
        : Promise.resolve<User[]>([]),
    ]);
  } catch {
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = users[0];

  if (!user) {
    return new Response(JSON.stringify(restaurants.sort((a, b) => b.rating - a.rating)), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  }

  const ranked = restaurants
    .map((r) => ({ ...r, _score: scoreRestaurant(r, user) }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...r }) => r);

  return new Response(JSON.stringify(ranked), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}
