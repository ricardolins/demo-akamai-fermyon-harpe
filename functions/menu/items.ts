// ============================================================
// HANDLER DE ITENS DO CARDÁPIO — functions/menu/items.ts
//
// Versão do servidor de DESENVOLVIMENTO LOCAL (Node.js + Hono).
// Em produção, a lógica equivalente está em spin-app/src/index.ts.
//
// Responsabilidade: listar os pratos disponíveis de um restaurante.
// Chamado por: server.ts → app.get("/api/menu-items", ...)
// ============================================================

// Credenciais do Harper lidas das variáveis de ambiente.
// Duplicadas aqui porque cada arquivo functions/ é independente —
// em produção (WASM) tudo está em um único arquivo index.ts.
const HARPER_URL  = process.env.HARPER_URL  ?? "http://localhost:9925";
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

// Handler exportado — chamado pelo server.ts para GET /api/menu-items.
// Requer o parâmetro restaurant_id na query string.
export async function handleMenuItems(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const restaurantId = url.searchParams.get("restaurant_id");

  // Validação de entrada: sem restaurant_id não tem como saber qual cardápio buscar.
  // 400 Bad Request = erro causado pelo cliente (enviou requisição incompleta).
  if (!restaurantId) {
    return new Response(JSON.stringify({ error: "restaurant_id required" }), { status: 400 });
  }

  // unknown[] em vez de any[] — TypeScript mais restritivo.
  // "unknown" exige verificação de tipo antes de usar o valor.
  // Como só retornamos JSON sem processar os campos, unknown está correto aqui.
  let items: unknown[];
  try {
    items = await queryHarper(
      // available = true → não mostra itens fora de estoque ou removidos do cardápio
      // ORDER BY category → agrupa por categoria (Entradas, Pratos, Sobremesas, etc.)
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
      // 2 minutos de cache — itens mudam mais frequentemente que a lista de restaurantes
      // (preços, disponibilidade), por isso TTL menor que o /api/menu (5 min)
    },
  });
}
