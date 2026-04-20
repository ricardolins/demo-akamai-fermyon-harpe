// ============================================================
// HANDLER DE PERSONALIZAÇÃO — functions/personalization/index.ts
//
// Versão do servidor de DESENVOLVIMENTO LOCAL (Node.js + Hono).
// Em produção, a lógica equivalente está em spin-app/src/index.ts.
//
// Responsabilidade: retornar restaurantes ordenados por um score
// calculado com base no histórico e preferências do usuário.
// Este processamento acontece aqui no edge (sem ML externo).
//
// Chamado por: server.ts → app.get("/api/personalization", ...)
// ============================================================

// Interface do restaurante — [key: string]: unknown permite campos extras
// não declarados (Harper pode retornar campos adicionais sem quebrar o TypeScript)
interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  tags: string[];         // categorias do restaurante: ["burger", "grelhado", "americano"]
  [key: string]: unknown; // índice genérico: aceita qualquer outro campo sem erro
}

// Interface do usuário com dados de preferências e histórico
interface User {
  id: string;
  preferences: string[];  // tipos de comida preferidos: ["burger", "saudável"]
  order_history: string[]; // array de restaurant_ids já pedidos anteriormente
}

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

// ============================================================
// ALGORITMO DE SCORE DE PERSONALIZAÇÃO
//
// Calcula a relevância de um restaurante para um usuário específico.
// Quanto maior o score, mais relevante o restaurante é para aquele usuário.
//
// Fórmula:
//   score = rating_base + pedidos_anteriores + (tags_em_comum × 0.5)
//
// Exemplos:
//   Restaurante: rating=4.5, tags=["burger","americano"]
//   Usuário: preferences=["burger","saudável"], order_history=["rest-001","rest-001"]
//
//   score = 4.5
//         + 2  (pediu 2 vezes neste restaurante)
//         + 0.5 (1 tag em comum: "burger")
//         = 7.0
// ============================================================
function scoreRestaurant(restaurant: Restaurant, user: User): number {
  let score = restaurant.rating; // ponto de partida: nota do restaurante (ex: 4.5)

  // Conta quantas vezes o usuário pediu neste restaurante.
  // filter retorna apenas os IDs iguais ao restaurante atual, .length conta quantos.
  const orderCount = user.order_history.filter((id) => id === restaurant.id).length;
  score += orderCount; // +1 por pedido anterior (fidelidade)

  // Conta tags em comum entre restaurante e preferências do usuário.
  // restaurant.tags.filter(tag => user.preferences.includes(tag)) → array de tags que batem
  const tagMatches = restaurant.tags.filter((tag) => user.preferences.includes(tag)).length;
  score += tagMatches * 0.5; // +0.5 por tag em comum (afinidade de preferência)

  return score;
}

export async function handlePersonalization(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id"); // null se não enviado
  const region  = url.searchParams.get("region") ?? "sa-east-1";

  // Declaração antecipada das variáveis fora do try/catch para
  // que sejam acessíveis depois do bloco.
  let restaurants: Restaurant[], users: User[];
  try {
    // Promise.all executa as duas queries ao Harper EM PARALELO.
    // Sem paralelo: ~800ms + ~800ms = ~1600ms total.
    // Com paralelo: max(~800ms, ~800ms) = ~800ms — metade do tempo.
    //
    // A desestruturação [restaurants, users] captura os dois resultados
    // na ordem em que foram passados para Promise.all.
    [restaurants, users] = await Promise.all([
      queryHarper<Restaurant>(
        `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`
      ),
      userId
        ? queryHarper<User>(`SELECT * FROM foodedge.users WHERE id = '${userId}' LIMIT 1`)
        : Promise.resolve<User[]>([]), // sem userId → retorna array vazio sem ir ao Harper
    ]);
  } catch {
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = users[0]; // LIMIT 1 → primeiro (e único) resultado, ou undefined

  // Se não encontrou o usuário: ordena só por rating (sem personalização)
  if (!user) {
    return new Response(JSON.stringify(restaurants.sort((a, b) => b.rating - a.rating)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        // Sem usuário = dados genéricos = pode cachear no CDN
      },
    });
  }

  // Com usuário: aplica o algoritmo de score, ordena e remove o campo _score antes de enviar
  const ranked = restaurants
    .map((r) => ({ ...r, _score: scoreRestaurant(r, user) }))
    // spread + _score: cria novo objeto com todos os campos do restaurante + o score calculado
    .sort((a, b) => b._score - a._score) // ordena decrescente (maior score primeiro)
    .map(({ _score, ...r }) => r);        // desestrutura para remover _score do objeto final
    // { _score, ...r }: _score é extraído separadamente, ...r fica com o resto dos campos
    // Motivo: o frontend não precisa ver o score interno, apenas a ordem já comunica a relevância

  return new Response(JSON.stringify(ranked), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      // private → CDN não pode cachear (cada usuário tem resultado diferente)
      // no-store → browser também não cacheia (próxima requisição sempre vai ao servidor)
    },
  });
}
