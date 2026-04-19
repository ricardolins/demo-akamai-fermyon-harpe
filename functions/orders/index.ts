interface OrderItem {
  menu_item_id: string;
  name: string;
  quantity: number;
  price: number;
}

interface CreateOrderPayload {
  user_id: string;
  restaurant_id: string;
  items: OrderItem[];
  delivery_address: { street: string; city: string; lat: number; lon: number };
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

async function insertHarper(table: string, record: object): Promise<void> {
  await fetch(`${HARPER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: HARPER_AUTH },
    body: JSON.stringify({ operation: "insert", schema: "foodedge", table, records: [record] }),
  });
}

export async function handleOrders(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/orders/:id — consulta status
  if (req.method === "GET") {
    const id = url.pathname.split("/").pop();
    let rows: unknown[];
    try {
      rows = await queryHarper(`SELECT * FROM foodedge.orders WHERE id = '${id}' LIMIT 1`);
    } catch {
      return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!rows.length) return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(rows[0]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/orders — cria pedido
  if (req.method === "POST") {
    const body: CreateOrderPayload = await req.json();
    const total = body.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const now = Date.now();

    const order = {
      id: crypto.randomUUID(),
      ...body,
      status: "confirmed",
      total,
      created_at: now,
      estimated_delivery_at: now + 30 * 60 * 1000,
    };

    try {
      await insertHarper("orders", order);
    } catch {
      return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(order), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
