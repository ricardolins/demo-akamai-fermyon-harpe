// ============================================================
// MODAL DE PEDIDO — frontend/src/components/orderModal.ts
//
// Responsável por todo o fluxo de criação de um pedido:
//   1. Busca o cardápio do restaurante clicado
//   2. Exibe itens com controles de quantidade (+ e -)
//   3. Calcula o total em tempo real
//   4. Envia o pedido via POST /api/orders
//   5. Exibe confirmação com número do pedido e ETA
// ============================================================

import { createOrder } from "../lib/api";

// Tipo de um item do cardápio retornado pela API
interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

// CartItem estende MenuItem adicionando o campo "quantity".
// "extends" em interface copia todos os campos de MenuItem + adiciona novos.
interface CartItem extends MenuItem {
  quantity: number;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

// Busca o cardápio de um restaurante específico.
// Não usa a função "timed" do api.ts porque aqui não precisamos exibir métricas de latência.
async function fetchMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const res = await fetch(`${BASE}/api/menu-items?restaurant_id=${restaurantId}`);
  return res.json();
}

// Formata número como moeda brasileira (ex: 29.9 → "R$ 29,90")
// toLocaleString é nativo do browser e respeita o formato do locale passado.
function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Calcula o total do carrinho percorrendo todos os itens.
// Map.values() retorna um Iterator — Array.from() converte para array para usar .reduce().
// reduce(): começa com sum=0, para cada item soma price*quantity ao acumulador.
function calcTotal(cart: Map<string, CartItem>): number {
  return Array.from(cart.values()).reduce((sum, i) => sum + i.price * i.quantity, 0);
}

// ============================================================
// FUNÇÃO PRINCIPAL — abre o modal para um restaurante
// ============================================================
export async function openOrderModal(restaurantId: string, restaurantName: string) {

  // Busca cardápio antes de mostrar o modal (aguarda resposta da API)
  const items = await fetchMenuItems(restaurantId);

  // Map<string, CartItem>: chave = item.id, valor = item + quantidade
  // Map é escolhido em vez de objeto/array porque:
  //   - Inserção/busca por id é O(1)
  //   - Fácil remover itens com quantidade 0 (cart.delete())
  const cart = new Map<string, CartItem>();

  // Referências para os elementos do DOM — buscados uma vez e reutilizados
  const modal    = document.getElementById("order-modal")!;
  const nameEl   = document.getElementById("modal-restaurant-name")!;
  const itemsEl  = document.getElementById("modal-items")!;
  const totalEl  = document.getElementById("modal-total")!;
  const orderBtn = document.getElementById("modal-order-btn") as HTMLButtonElement;

  nameEl.textContent = restaurantName;

  // Recalcula e exibe o total sempre que o carrinho muda.
  // Desabilita o botão "Fazer pedido" se o total for zero (carrinho vazio).
  function updateTotal() {
    const total = calcTotal(cart);
    totalEl.textContent = `Total: ${formatCurrency(total)}`;
    orderBtn.disabled = total === 0;
  }

  // Gera o HTML de cada item do cardápio com controles de quantidade
  itemsEl.innerHTML = items.map((item) => `
    <div class="menu-item" data-id="${item.id}">
      <div class="menu-item-info">
        <h3>${item.name}</h3>
        <p>${item.description}</p>
      </div>
      <span class="menu-item-price">${formatCurrency(item.price)}</span>
      <div class="qty-control">
        <button class="qty-minus">−</button>
        <span class="qty-value">0</span>
        <button class="qty-plus">+</button>
      </div>
    </div>
  `).join("");

  // Adiciona listeners de +/- para cada item do cardápio
  itemsEl.querySelectorAll(".menu-item").forEach((row, idx) => {
    const item = items[idx]; // usa o índice para correlacionar DOM com dados
    const qtyEl = row.querySelector(".qty-value")!;

    // Botão "+": incrementa quantidade no carrinho
    row.querySelector(".qty-plus")!.addEventListener("click", () => {
      const current = cart.get(item.id);
      const qty = (current?.quantity ?? 0) + 1; // ?. evita erro se current for undefined
      cart.set(item.id, { ...item, quantity: qty }); // atualiza ou cria entrada no Map
      qtyEl.textContent = String(qty);
      updateTotal();
    });

    // Botão "−": decrementa quantidade, remove do carrinho se chegar a 0
    row.querySelector(".qty-minus")!.addEventListener("click", () => {
      const current = cart.get(item.id);
      if (!current || current.quantity === 0) return; // já está em zero, ignora
      const qty = current.quantity - 1;
      if (qty === 0) cart.delete(item.id);             // remove completamente do carrinho
      else cart.set(item.id, { ...item, quantity: qty });
      qtyEl.textContent = String(qty);
      updateTotal();
    });
  });

  updateTotal();                     // atualiza total inicial (zero) e desabilita botão
  modal.classList.remove("hidden"); // exibe o modal (remove classe CSS que o esconde)

  // Fechar modal: adiciona classe "hidden" de volta
  document.getElementById("modal-close")!.onclick = () => modal.classList.add("hidden");

  // ============================================================
  // SUBMISSÃO DO PEDIDO
  // ============================================================
  orderBtn.onclick = async () => {
    orderBtn.disabled = true;
    orderBtn.textContent = "Enviando...";

    // Se nenhum usuário estiver selecionado, usa um usuário padrão da demo
    const userId = localStorage.getItem("user_id") ?? "user-003";

    // Converte o Map do carrinho para o formato esperado pela API:
    // Array.from(cart.values()) → array de CartItem
    // .map() → array de objetos com apenas os campos necessários
    const cartItems = Array.from(cart.values()).map((i) => ({
      menu_item_id: i.id,
      name: i.name,
      quantity: i.quantity,
      price: i.price,
    }));

    // Envia o pedido — createOrder faz POST /api/orders e retorna { data, ms }
    const { data, ms } = await createOrder({
      user_id: userId,
      restaurant_id: restaurantId,
      items: cartItems,
      // Endereço fixo para a demo (em produção viria do cadastro do usuário)
      delivery_address: { street: "Av. Paulista, 1000", city: "São Paulo", lat: -23.561, lon: -46.655 },
    });

    modal.classList.add("hidden"); // fecha o modal de itens

    // Exibe o modal de confirmação com número do pedido e ETA
    const order = data as { id: string; estimated_delivery_at: number };

    // new Date(timestamp) converte milissegundos Unix para objeto Date do browser
    // toLocaleTimeString formata como "19:45" (hora local do usuário)
    const eta = new Date(order.estimated_delivery_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    const confirm = document.getElementById("confirm-modal")!;

    // .slice(0, 8).toUpperCase() pega os primeiros 8 caracteres do UUID e capitaliza
    // Ex: "550e8400-..." → "550E8400"
    document.getElementById("confirm-id")!.textContent   = `Pedido #${order.id.slice(0, 8).toUpperCase()}`;
    document.getElementById("confirm-time")!.textContent = `Entrega prevista às ${eta} · criado em ${ms}ms`;

    confirm.classList.remove("hidden"); // exibe o modal de confirmação
    document.getElementById("confirm-close")!.onclick = () => confirm.classList.add("hidden");
  };
}
