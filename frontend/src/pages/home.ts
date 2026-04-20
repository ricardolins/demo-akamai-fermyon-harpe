// ============================================================
// PÁGINA HOME — frontend/src/pages/home.ts
//
// Controla toda a lógica da tela principal:
//   - Seletor de usuário (personalização)
//   - Botão de geolocalização
//   - Filtros por culinária
//   - Renderização do grid de restaurantes
//   - Clique no card → abre modal de pedido
// ============================================================

import { fetchPersonalized, fetchRestaurants, fetchNearby } from "../lib/api";
import { openOrderModal } from "../components/orderModal";

// Tipo que descreve a estrutura de um restaurante retornado pela API.
// O ? indica que o campo é opcional — só presente quando vem do endpoint /api/geo.
interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  delivery_time_min: number;
  delivery_fee: number;
  image_url: string;
  tags: string[];
  distance_km?: number;           // só presente na resposta do /api/geo
  estimated_delivery_min?: number; // só presente na resposta do /api/geo
}

// Atualiza os elementos de métricas na tela (ex: "208ms → Harper" ou "12ms ⚡ cache")
// document.getElementById busca o elemento HTML pelo atributo id.
// textContent define o texto visível do elemento.
function setMetric(id: string, ms: number, cached: boolean) {
  const el = document.getElementById(id);
  if (el) el.textContent = cached ? `${ms}ms ⚡ cache` : `${ms}ms → Harper`;
}

// Gera o HTML de um card de restaurante como string.
// Template literals (crase + ${}) permitem interpolar variáveis dentro do HTML.
// onerror no <img> é um fallback: se a imagem falhar, pinta o fundo de cinza.
function renderCard(r: Restaurant): string {
  // Badge de distância — só aparece quando vem do endpoint geo
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

// Renderiza o grid completo substituindo o innerHTML do container.
// Depois adiciona listener de clique em cada card para abrir o modal.
function renderGrid(restaurants: Restaurant[]) {
  const grid = document.getElementById("restaurants-grid");
  if (!grid) return;

  // .map(renderCard) cria um array de strings HTML, .join("") as concatena
  grid.innerHTML = restaurants.map(renderCard).join("");

  // querySelectorAll retorna todos os elementos que batem com o seletor CSS
  // forEach percorre cada um e adiciona o event listener de clique
  grid.querySelectorAll<HTMLElement>(".restaurant-card").forEach((card) => {
    card.addEventListener("click", () => {
      // dataset.id lê o atributo data-id do elemento HTML
      // O ! diz ao TypeScript "confio que não é null" (non-null assertion)
      const id = card.dataset.id!;
      const name = card.querySelector("h2")!.textContent!;
      openOrderModal(id, name);
    });
  });
}

// ============================================================
// LÓGICA DE CARREGAMENTO
//
// Decide qual endpoint chamar com base no estado atual:
//   - usuário selecionado + sem filtro de culinária → personalização
//   - culinária filtrada → menu normal com filtro
//   - sem usuário + sem filtro → menu normal sem filtro
// ============================================================
async function loadRestaurants(cuisine?: string) {
  const userId = localStorage.getItem("user_id"); // recupera usuário salvo no browser
  const region = "sa-east-1"; // região fixa para a demo (São Paulo)

  if (userId && !cuisine) {
    // Com usuário e sem filtro: usa personalização (score calculado no edge)
    const { data, ms, cached, region: edgeRegion } = await fetchPersonalized({ user_id: userId, region });
    setMetric("metric-personalization", ms, cached);
    document.getElementById("edge-region")!.textContent = edgeRegion;
    renderGrid(data as Restaurant[]);
  } else {
    // Sem usuário ou com filtro: menu padrão (ordenado por rating)
    const { data, ms, cached, region: edgeRegion } = await fetchRestaurants({ region, cuisine });
    setMetric("metric-menu", ms, cached);
    document.getElementById("edge-region")!.textContent = edgeRegion;
    renderGrid(data as Restaurant[]);
  }
}

// ============================================================
// INICIALIZAÇÃO — chamada pelo main.ts quando a página carrega
// ============================================================
export function initHome() {

  // Restaura o usuário salvo (localStorage persiste entre sessões do browser)
  const saved = localStorage.getItem("user_id") ?? "";
  const select = document.getElementById("user-select") as HTMLSelectElement;
  if (select) select.value = saved; // pré-seleciona o usuário no <select>

  loadRestaurants(); // carregamento inicial

  // Painel de métricas oculto — revela com 3 cliques no logo
  let clickCount = 0;
  let clickTimer: ReturnType<typeof setTimeout>;
  document.querySelector("header h1")?.addEventListener("click", () => {
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { clickCount = 0; }, 600);
    if (clickCount >= 3) {
      document.getElementById("metrics-panel")?.classList.toggle("hidden");
      clickCount = 0;
    }
  });

  // TROCA DE USUÁRIO
  // "change" dispara quando o valor do <select> muda
  select?.addEventListener("change", () => {
    const userId = select.value;
    if (userId) {
      localStorage.setItem("user_id", userId);   // salva para próximas visitas
    } else {
      localStorage.removeItem("user_id");         // limpa (modo sem personalização)
    }
    // Reseta filtros de culinária ao trocar usuário
    document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
    document.querySelector("#filters button[data-cuisine='']")?.classList.add("active");
    loadRestaurants();
  });

  // BOTÃO DE GEOLOCALIZAÇÃO
  // navigator.geolocation é a API nativa do browser para obter coordenadas GPS.
  const geoBtn = document.getElementById("geo-btn") as HTMLButtonElement;
  geoBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocalização não suportada neste browser.");
      return;
    }
    geoBtn.disabled = true;
    geoBtn.textContent = "📍 Localizando...";

    // getCurrentPosition é assíncrono: chama o primeiro callback com sucesso,
    // ou o segundo callback em caso de erro (usuário negou permissão, timeout, etc.)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Sucesso: usa coordenadas reais do GPS/WiFi do dispositivo
        const { latitude: lat, longitude: lon } = pos.coords;
        const { data, ms, cached } = await fetchNearby({ lat, lon, radius: 10 });
        setMetric("metric-geo", ms, cached);
        document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
        renderGrid(data as Restaurant[]);
        geoBtn.textContent = "📍 Localização ativa";
      },
      async () => {
        // Fallback: usuário não permitiu GPS → usa coordenadas simuladas de São Paulo
        // Lat/lon -23.558, -46.648 ≈ região da Av. Paulista
        const { data, ms, cached } = await fetchNearby({ lat: -23.558, lon: -46.648, radius: 10 });
        setMetric("metric-geo", ms, cached);
        document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
        renderGrid(data as Restaurant[]);
        geoBtn.textContent = "📍 SP simulado";
        geoBtn.disabled = false;
      }
    );
  });

  // FILTROS DE CULINÁRIA
  // Event delegation: um único listener no container "#filters" captura cliques
  // em qualquer botão filho — mais eficiente que um listener por botão.
  document.getElementById("filters")?.addEventListener("click", (e) => {
    // .closest() sobe na árvore do DOM até encontrar um botão com data-cuisine
    // Isso funciona mesmo se o clique for em um elemento filho do botão
    const btn = (e.target as HTMLElement).closest("button[data-cuisine]");
    if (!btn) return;

    // Remove "active" de todos os botões, adiciona só no clicado
    document.querySelectorAll("#filters button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // dataset.cuisine lê o atributo data-cuisine do botão
    // || undefined converte string vazia "" para undefined (sem filtro)
    const cuisine = (btn as HTMLButtonElement).dataset.cuisine || undefined;
    loadRestaurants(cuisine);
  });
}
