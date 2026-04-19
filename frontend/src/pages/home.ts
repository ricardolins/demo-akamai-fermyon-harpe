import { fetchPersonalized, fetchRestaurants, fetchNearby } from "../lib/api";
import { openOrderModal } from "../components/orderModal";

interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  delivery_time_min: number;
  delivery_fee: number;
  image_url: string;
  tags: string[];
  // presentes só quando vem do endpoint geo
  distance_km?: number;
  estimated_delivery_min?: number;
}

function setMetric(id: string, ms: number, cached: boolean) {
  const el = document.getElementById(id);
  if (el) el.textContent = cached ? `${ms}ms ⚡ cache` : `${ms}ms → Harper`;
}

function renderCard(r: Restaurant): string {
  const distanceBadge = r.distance_km !== undefined
    ? `<span class="distance-badge">📍 ${r.distance_km} km · ${r.estimated_delivery_min} min</span>`
    : "";
  return `
    <div class="restaurant-card" data-id="${r.id}">
      <img src="${r.image_url}" alt="${r.name}" onerror="this.style.background='#eee'" />
      <div class="card-info">
        <h2>${r.name}</h2>
        <span class="cuisine">${r.cuisine}</span>
        ${distanceBadge}
        <div class="card-meta">
          <span>⭐ ${r.rating}</span>
          <span>${r.estimated_delivery_min ?? r.delivery_time_min} min</span>
          <span>R$ ${r.delivery_fee.toFixed(2)}</span>
        </div>
      </div>
    </div>`;
}

function renderGrid(restaurants: Restaurant[]) {
  const grid = document.getElementById("restaurants-grid");
  if (!grid) return;
  grid.innerHTML = restaurants.map(renderCard).join("");

  grid.querySelectorAll<HTMLElement>(".restaurant-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id!;
      const name = card.querySelector("h2")!.textContent!;
      openOrderModal(id, name);
    });
  });
}

async function loadRestaurants(cuisine?: string) {
  const userId = localStorage.getItem("user_id");
  const region = "sa-east-1";

  if (userId && !cuisine) {
    const { data, ms, cached, region: edgeRegion } = await fetchPersonalized({ user_id: userId, region });
    setMetric("metric-personalization", ms, cached);
    document.getElementById("edge-region")!.textContent = edgeRegion;
    renderGrid(data as Restaurant[]);
  } else {
    const { data, ms, cached, region: edgeRegion } = await fetchRestaurants({ region, cuisine });
    setMetric("metric-menu", ms, cached);
    document.getElementById("edge-region")!.textContent = edgeRegion;
    renderGrid(data as Restaurant[]);
  }
}

export function initHome() {
  // Restaura usuário salvo
  const saved = localStorage.getItem("user_id") ?? "";
  const select = document.getElementById("user-select") as HTMLSelectElement;
  if (select) select.value = saved;

  loadRestaurants();

  // Troca de usuário → recarrega com personalização
  select?.addEventListener("change", () => {
    const userId = select.value;
    if (userId) {
      localStorage.setItem("user_id", userId);
    } else {
      localStorage.removeItem("user_id");
    }
    // Volta filtro para "Todos"
    document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
    document.querySelector("#filters button[data-cuisine='']")?.classList.add("active");
    loadRestaurants();
  });

  // Botão de geolocalização
  const geoBtn = document.getElementById("geo-btn") as HTMLButtonElement;
  geoBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocalização não suportada neste browser.");
      return;
    }
    geoBtn.disabled = true;
    geoBtn.textContent = "📍 Localizando...";

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const { data, ms, cached } = await fetchNearby({ lat, lon, radius: 10 });
        setMetric("metric-geo", ms, cached);
        // Desmarca filtros — geo tem prioridade
        document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
        renderGrid(data as Restaurant[]);
        geoBtn.textContent = "📍 Localização ativa";
      },
      // Fallback: coordenadas simuladas de São Paulo (para demo sem permissão)
      async () => {
        const { data, ms, cached } = await fetchNearby({ lat: -23.558, lon: -46.648, radius: 10 });
        setMetric("metric-geo", ms, cached);
        document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
        renderGrid(data as Restaurant[]);
        geoBtn.textContent = "📍 SP simulado";
        geoBtn.disabled = false;
      }
    );
  });

  document.getElementById("filters")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-cuisine]");
    if (!btn) return;
    document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const cuisine = (btn as HTMLButtonElement).dataset.cuisine || undefined;
    loadRestaurants(cuisine);
  });
}
