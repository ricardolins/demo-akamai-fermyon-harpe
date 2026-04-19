interface Restaurant {
  id: string;
  name: string;
  location: { lat: number; lon: number };
  delivery_time_min: number;
  [key: string]: unknown;
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

// Fórmula de Haversine — distância em km entre dois pontos geográficos
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDeliveryTime(baseMin: number, distanceKm: number): number {
  // +5 min por cada km acima de 2km
  const extra = Math.max(0, distanceKm - 2) * 5;
  return Math.round(baseMin + extra);
}

export async function handleGeo(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "0");
  const lon = parseFloat(url.searchParams.get("lon") ?? "0");
  const radiusKm = parseFloat(url.searchParams.get("radius") ?? "5");

  let restaurants: Restaurant[];
  try {
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
      const distance = haversineKm(lat, lon, r.location.lat, r.location.lon);
      return {
        ...r,
        distance_km: Math.round(distance * 10) / 10,
        estimated_delivery_min: estimateDeliveryTime(r.delivery_time_min, distance),
      };
    })
    .filter((r) => r.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);

  return new Response(JSON.stringify(nearby), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
    },
  });
}
