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

export async function handleMenuItems(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const restaurantId = url.searchParams.get("restaurant_id");

  if (!restaurantId) {
    return new Response(JSON.stringify({ error: "restaurant_id required" }), { status: 400 });
  }

  let items: unknown[];
  try {
    items = await queryHarper(
      `SELECT * FROM foodedge.menu_items WHERE restaurant_id = '${restaurantId}' AND available = true ORDER BY category`
    );
  } catch {
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(items), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
    },
  });
}
