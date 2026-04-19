const BASE = import.meta.env.VITE_API_BASE ?? "";

async function timed<T>(label: string, fn: () => Promise<Response>): Promise<{ data: T; ms: number; cached: boolean; region: string }> {
  const t0 = performance.now();
  const res = await fn();
  const region = res.headers.get("X-Edge-Region") ?? "unknown";
  const data: T = await res.json();
  const ms = Math.round(performance.now() - t0);

  // transferSize === 0 significa que veio do cache do browser
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const entry = entries.reverse().find((e) => e.name.includes(`/api/${label === "menu" ? "menu" : label}`));
  const cached = entry ? entry.transferSize === 0 : ms < 10;

  console.log(`[${label}] ${ms}ms cached=${cached} region=${region}`);
  return { data, ms, cached, region };
}

export async function fetchRestaurants(params: { region?: string; cuisine?: string }) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  );
  const qs = new URLSearchParams(clean as Record<string, string>).toString();
  return timed<object[]>("menu", () => fetch(`${BASE}/api/menu?${qs}`));
}

export async function fetchPersonalized(params: { user_id: string; region?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return timed<object[]>("personalization", () => fetch(`${BASE}/api/personalization?${qs}`));
}

export async function fetchNearby(params: { lat: number; lon: number; radius?: number }) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  return timed<object[]>("geo", () => fetch(`${BASE}/api/geo?${qs}`));
}

export async function createOrder(payload: object) {
  return timed<object>("orders", () =>
    fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function getOrder(id: string) {
  return timed<object>("orders", () => fetch(`${BASE}/api/orders/${id}`));
}
