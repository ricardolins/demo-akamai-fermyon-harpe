// ============================================================
// CAMADA DE ACESSO À API — frontend/src/lib/api.ts
//
// Este arquivo abstrai todas as chamadas HTTP para a edge function.
// Centralizar aqui tem duas vantagens:
//   1. O resto do frontend não precisa saber a URL da API
//   2. Toda chamada ganha métricas de latência e detecção de cache automaticamente
// ============================================================

// import.meta.env é uma feature do Vite que injeta variáveis de ambiente no build.
// VITE_API_BASE é definido no .env como a URL da Akamai Functions.
// ?? "" significa: se não estiver definido, usa string vazia (chamadas relativas — útil no dev local).
const BASE = import.meta.env.VITE_API_BASE ?? "";

// ============================================================
// FUNÇÃO timed<T> — wrapper que mede latência e detecta cache
//
// É genérica: timed<Restaurant[]> retorna { data: Restaurant[], ms, cached, region }
// O parâmetro "fn" é uma função que retorna uma Promise<Response> —
// assim timed pode medir qualquer fetch sem saber os detalhes da chamada.
// ============================================================
async function timed<T>(
  label: string,           // nome da rota, usado para localizar a entrada no PerformanceResourceTiming
  fn: () => Promise<Response>  // a função de fetch a ser executada e medida
): Promise<{ data: T; ms: number; cached: boolean; region: string }> {

  const t0 = performance.now(); // timestamp de alta precisão em ms (ex: 1234.567)
  const res = await fn();       // executa o fetch e aguarda a resposta

  // Lê o header customizado que a edge function injeta para indicar de qual PoP veio.
  const region = res.headers.get("X-Edge-Region") ?? "unknown";

  // Aguarda o parse completo do JSON — mede até aqui para incluir tempo de transferência do body
  const data: T = await res.json();
  const ms = Math.round(performance.now() - t0); // arredonda para inteiro

  // ============================================================
  // DETECÇÃO DE CACHE DO CDN
  //
  // A API Performance do browser registra detalhes de cada recurso carregado.
  // PerformanceResourceTiming.transferSize === 0 significa que a resposta
  // veio do cache do browser (sem nenhum byte trafegado pela rede).
  //
  // NOTA: isso detecta cache do BROWSER, não do CDN.
  // Se o CDN cacheou mas o browser não, transferSize será > 0 (mas ms será baixo).
  // A detecção por ms < 10 como fallback cobre o caso de cache CDN.
  // ============================================================
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

  // .reverse() para pegar a entrada mais recente (a última requisição para essa URL)
  const entry = entries.reverse().find(
    (e) => e.name.includes(`/api/${label === "menu" ? "menu" : label}`)
  );

  const cached = entry ? entry.transferSize === 0 : ms < 10;

  console.log(`[${label}] ${ms}ms cached=${cached} region=${region}`);
  return { data, ms, cached, region };
}

// ============================================================
// FUNÇÕES PÚBLICAS — usadas pelos componentes do frontend
// ============================================================

// Busca restaurantes por região e tipo de culinária.
// Object.fromEntries + filter remove chaves com valor undefined ou "" do objeto,
// evitando que ?cuisine=undefined apareça na query string (causaria zero resultados).
export async function fetchRestaurants(params: { region?: string; cuisine?: string }) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  );
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  return timed<object[]>("menu", () => fetch(`${BASE}/api/menu?${qs}`));
}

// Busca restaurantes ordenados por score personalizado do usuário.
// user_id é obrigatório aqui (diferente de fetchRestaurants).
export async function fetchPersonalized(params: { user_id: string; region?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return timed<object[]>("personalization", () => fetch(`${BASE}/api/personalization?${qs}`));
}

// Busca restaurantes próximos usando lat/lon do usuário.
// Object.entries + map converte números para string — URLSearchParams só aceita strings.
export async function fetchNearby(params: { lat: number; lon: number; radius?: number }) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  return timed<object[]>("geo", () => fetch(`${BASE}/api/geo?${qs}`));
}

// Cria um novo pedido via POST com corpo JSON.
// Retorna o pedido criado (com id e estimated_delivery_at gerados na edge function).
export async function createOrder(payload: object) {
  return timed<object>("orders", () =>
    fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

// Consulta o status de um pedido pelo ID.
export async function getOrder(id: string) {
  return timed<object>("orders", () => fetch(`${BASE}/api/orders/${id}`));
}
