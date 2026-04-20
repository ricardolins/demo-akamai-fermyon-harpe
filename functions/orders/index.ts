// ============================================================
// HANDLER DE PEDIDOS — functions/orders/index.ts
//
// Versão do servidor de DESENVOLVIMENTO LOCAL (Node.js + Hono).
// Em produção, a lógica equivalente está em spin-app/src/index.ts.
//
// Trata dois métodos HTTP no mesmo handler:
//   GET  /api/orders/:id  → consulta pedido existente
//   POST /api/orders      → cria novo pedido
//
// Chamado por: server.ts → app.get/post("/api/orders", ...)
// ============================================================

// Interface que descreve um item dentro do pedido.
// Cada item do carrinho vira um OrderItem no payload enviado para a API.
interface OrderItem {
  menu_item_id: string; // ID do item no Harper (foodedge.menu_items)
  name: string;         // nome do prato (ex: "X-Burguer Duplo")
  quantity: number;     // quantidade pedida
  price: number;        // preço unitário no momento do pedido (histórico)
}

// Interface do corpo JSON enviado pelo frontend ao criar um pedido.
// O TypeScript verifica que o body tem exatamente esses campos.
interface CreateOrderPayload {
  user_id: string;
  restaurant_id: string;
  items: OrderItem[];
  delivery_address: {
    street: string;
    city: string;
    lat: number; // latitude — para futuro cálculo de ETA mais preciso
    lon: number; // longitude
  };
}

const HARPER_URL  = process.env.HARPER_URL  ?? "http://localhost:9925";
const HARPER_AUTH = `Basic ${btoa(
  `${process.env.HARPER_USER ?? "HDB_ADMIN"}:${process.env.HARPER_PASS ?? "password"}`
)}`;

// Consulta SQL genérica ao Harper
async function queryHarper<T>(sql: string): Promise<T[]> {
  const res = await fetch(`${HARPER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: HARPER_AUTH },
    body: JSON.stringify({ operation: "sql", sql }),
  });
  return res.json();
}

// Insere um registro no Harper usando a operação nativa "insert" (mais eficiente que SQL INSERT).
// schema = banco de dados ("foodedge"), table = tabela ("orders")
async function insertHarper(table: string, record: object): Promise<void> {
  await fetch(`${HARPER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: HARPER_AUTH },
    // records é um array — Harper suporta inserção em lote, mas aqui mandamos 1 por vez
    body: JSON.stringify({ operation: "insert", schema: "foodedge", table, records: [record] }),
  });
}

// Handler unificado para GET e POST de pedidos.
// O server.ts registra este handler para ambos os métodos:
//   app.post("/api/orders", ...)
//   app.get("/api/orders/:id", ...)
export async function handleOrders(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // ============================================================
  // GET /api/orders/:id — busca um pedido pelo ID
  // ============================================================
  if (req.method === "GET") {
    // url.pathname = "/api/orders/550e8400-e29b-41d4-a716-446655440000"
    // .split("/") = ["", "api", "orders", "550e8400-..."]
    // .pop() pega o último elemento = "550e8400-..."
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

    // LIMIT 1 garante no máximo 1 resultado, mas rows pode ser [] se o ID não existir
    if (!rows.length) return new Response("Not found", { status: 404 });

    // rows[0] é o primeiro (e único) pedido encontrado
    return new Response(JSON.stringify(rows[0]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ============================================================
  // POST /api/orders — cria um novo pedido
  // ============================================================
  if (req.method === "POST") {
    // req.json() lê e faz parse do corpo da requisição.
    // CreateOrderPayload diz ao TypeScript quais campos esperar.
    const body: CreateOrderPayload = await req.json();

    // Calcula o total somando preço × quantidade de cada item.
    // reduce(acumulador, itemAtual) → começa em 0 e vai somando a cada item.
    const total = body.items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const now = Date.now(); // milissegundos desde 01/01/1970 (Unix timestamp)

    const order = {
      id: crypto.randomUUID(), // UUID v4: identificador único universal (ex: "550e8400-e29b-41d4-...")
      ...body,                 // spread: copia user_id, restaurant_id, items, delivery_address
      status: "confirmed",     // status inicial — em produção teria: pending → confirmed → preparing → delivered
      total,
      created_at: now,
      estimated_delivery_at: now + 30 * 60 * 1000,
      // now + 30 minutos em milissegundos: 30 * 60 segundos * 1000 ms/s = 1.800.000 ms
    };

    try {
      await insertHarper("orders", order);
    } catch {
      return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 201 Created: diferente do 200 OK, indica especificamente que um recurso foi criado.
    return new Response(JSON.stringify(order), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Qualquer outro método HTTP (PUT, DELETE, PATCH...) retorna 405.
  // 405 Method Not Allowed: o endpoint existe, mas não suporta este método.
  return new Response("Method not allowed", { status: 405 });
}
