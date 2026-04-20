// ============================================================
// HANDLER DE MENU — functions/menu/index.ts
//
// Versão do servidor de DESENVOLVIMENTO LOCAL (Node.js + Hono).
// Em produção, a lógica equivalente está em spin-app/src/index.ts.
//
// Responsabilidade: listar restaurantes por região e culinária.
// Chamado por: server.ts → app.get("/api/menu", ...)
// ============================================================

// Interface define a "forma" de um objeto Restaurant no TypeScript.
// Serve como contrato: garante que todo restaurante retornado pelo Harper
// terá exatamente esses campos com esses tipos.
// Se o Harper retornar um campo diferente, o TypeScript avisa em tempo de compilação.
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
  tags: string[]; // array de strings: ex. ["burger", "grelhado", "americano"]
}

// Lê credenciais das variáveis de ambiente do Node.js (process.env).
// No desenvolvimento, essas variáveis vêm do arquivo .env carregado pelo servidor.
// O ?? fornece valores padrão para quando o .env não estiver configurado.
const HARPER_URL  = process.env.HARPER_URL  ?? "http://localhost:9925";
const HARPER_AUTH = `Basic ${btoa(
  `${process.env.HARPER_USER ?? "HDB_ADMIN"}:${process.env.HARPER_PASS ?? "password"}`
)}`;
// btoa() converte "usuario:senha" para Base64 — formato exigido pelo HTTP Basic Auth.
// Exemplo: "foodedge-app:Teste2026-" → "Zm9vZGVkZ2UtYXBwOlRlc3RlMjAyNi0="

// Função genérica de consulta SQL ao Harper.
// <T> é um "generic" — o tipo do resultado é definido por quem chama.
// Exemplo: queryHarper<Restaurant>(sql) retorna Promise<Restaurant[]>
async function queryHarper<T>(sql: string): Promise<T[]> {
  const res = await fetch(`${HARPER_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: HARPER_AUTH },
    // Harper usa API REST: toda operação é POST para "/" com JSON no body.
    // "operation: sql" indica que o campo "sql" contém uma query SQL.
    body: JSON.stringify({ operation: "sql", sql }),
  });
  return res.json(); // parse do JSON de resposta
}

// Handler exportado — chamado pelo server.ts para cada requisição GET /api/menu.
// Recebe o objeto Request nativo da Web API e retorna uma Promise<Response>.
export async function handleMenu(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // new URL() faz parse completo da URL, incluindo query string.
  // Exemplo: new URL("http://localhost:3000/api/menu?region=sa-east-1&cuisine=Pizza")
  //   → url.searchParams.get("region") = "sa-east-1"
  //   → url.searchParams.get("cuisine") = "Pizza"

  const region  = url.searchParams.get("region")  ?? "sa-east-1";
  const cuisine = url.searchParams.get("cuisine"); // null se não enviado

  // Monta SQL dinamicamente.
  // Começa com os filtros obrigatórios (ativo + região) e adiciona culinária se informada.
  let sql = `SELECT * FROM foodedge.restaurants WHERE active = true AND region = '${region}'`;
  if (cuisine) sql += ` AND cuisine = '${cuisine}'`;
  sql += " ORDER BY rating DESC"; // melhor avaliados primeiro

  let restaurants: Restaurant[];
  try {
    restaurants = await queryHarper<Restaurant>(sql);
  } catch {
    // 503 Service Unavailable: Harper inacessível (rede, credenciais, etc.)
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(restaurants), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      // public → CDN pode cachear (dados não são específicos de usuário)
      // max-age=300 → válido por 5 minutos (300 segundos)
      "X-Edge-Region": region,
      // Header customizado para o frontend exibir de qual região veio a resposta
    },
  });
}
