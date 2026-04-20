// ============================================================
// HANDLER DE GEOLOCALIZAÇÃO — functions/geo/index.ts
//
// Versão do servidor de DESENVOLVIMENTO LOCAL (Node.js + Hono).
// Em produção, a lógica equivalente está em spin-app/src/index.ts.
//
// Responsabilidade: receber coordenadas GPS do usuário e retornar
// restaurantes dentro de um raio, com distância e ETA calculados.
// Todo o processamento é feito aqui — sem geocoding externo, sem Google Maps.
//
// Chamado por: server.ts → app.get("/api/geo", ...)
// ============================================================

// Interface mínima do restaurante para o cálculo geo.
// location é um objeto aninhado com lat/lon — estrutura JSON do Harper.
// [key: string]: unknown aceita campos extras sem quebrar o TypeScript.
interface Restaurant {
  id: string;
  name: string;
  location: { lat: number; lon: number }; // coordenadas geográficas do restaurante
  delivery_time_min: number;              // tempo base de entrega em minutos
  [key: string]: unknown;
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
// FÓRMULA DE HAVERSINE
//
// Calcula a distância em quilômetros entre dois pontos na superfície da Terra.
// Necessária porque a Terra é esférica — distância em linha reta (euclidiana)
// seria incorreta para coordenadas geográficas.
//
// Parâmetros: lat1/lon1 = usuário, lat2/lon2 = restaurante (em graus decimais)
// Retorno: distância em km (ex: 3.7)
//
// Exemplo real: São Paulo (-23.558, -46.648) → restaurante (-23.570, -46.633)
//   Resultado: ~1.7 km
// ============================================================
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // raio médio da Terra em km (varia entre 6357 e 6378 — usamos a média)

  // Converte diferença de graus para radianos.
  // Trigonometria (sin, cos) trabalha em radianos, não graus.
  // Conversão: radianos = graus × (π / 180)
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  // "a" = quadrado do seno do semi-ângulo central
  // É a parte central da fórmula de Haversine que lida com a curvatura da Terra.
  // ** é operador de exponenciação: x ** 2 = x²
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;

  // atan2 calcula o ângulo central em radianos.
  // Multiplicado pelo diâmetro (2R) dá a distância do arco na superfície da Terra.
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// ESTIMATIVA DE TEMPO DE ENTREGA
//
// Modelo simples: tempo base do restaurante + penalidade por distância.
// Acima de 2km, cada km adicional soma 5 minutos.
//
// Exemplo:
//   restaurante a 1km, tempo_base=25min → 25 + max(0, 1-2)*5 = 25 min
//   restaurante a 5km, tempo_base=25min → 25 + max(0, 5-2)*5 = 40 min
// ============================================================
function estimateDeliveryTime(baseMin: number, distanceKm: number): number {
  const extra = Math.max(0, distanceKm - 2) * 5;
  // Math.max(0, x) garante que o valor nunca seja negativo
  // (restaurantes dentro de 2km não têm penalidade)
  return Math.round(baseMin + extra);
}

export async function handleGeo(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // parseFloat converte string para número decimal.
  // Coordenadas GPS têm casas decimais (ex: "-23.5580").
  const lat      = parseFloat(url.searchParams.get("lat")    ?? "0");
  const lon      = parseFloat(url.searchParams.get("lon")    ?? "0");
  const radiusKm = parseFloat(url.searchParams.get("radius") ?? "5"); // raio padrão 5km

  let restaurants: Restaurant[];
  try {
    // Busca TODOS os restaurantes ativos — o filtro por raio é feito em memória abaixo.
    // Harper não tem operadores geoespaciais (ST_Distance, etc.) como PostGIS,
    // então não conseguimos filtrar direto no SQL.
    // Em produção com muitos restaurantes, isso seria um problema de performance.
    restaurants = await queryHarper<Restaurant>(
      "SELECT * FROM foodedge.restaurants WHERE active = true"
    );
  } catch {
    return new Response(JSON.stringify({ error: "HarperDB unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nearby = restaurants
    .map((r) => {
      // Calcula distância real entre usuário e cada restaurante
      const distance = haversineKm(lat, lon, r.location.lat, r.location.lon);
      return {
        ...r, // spread: mantém todos os campos originais do restaurante
        distance_km: Math.round(distance * 10) / 10,
        // Math.round(x * 10) / 10 arredonda para 1 casa decimal
        // Exemplo: 3.14159 → 31.4159 → round → 31 → 3.1
        estimated_delivery_min: estimateDeliveryTime(r.delivery_time_min, distance),
      };
    })
    .filter((r) => r.distance_km <= radiusKm)    // remove os que estão fora do raio
    .sort((a, b) => a.distance_km - b.distance_km); // ordena do mais próximo para o mais distante

  return new Response(JSON.stringify(nearby), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
      // 2 minutos de cache — geo pode ser compartilhado entre usuários próximos.
      // Em produção ideal, a chave de cache incluiria lat/lon/raio para ser precisa.
    },
  });
}
