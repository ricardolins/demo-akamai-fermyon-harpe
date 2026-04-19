import { createOrder } from "../lib/api";

interface MenuItem {
  id: string;
  restaurant_id: string;
  name: string;
  description: string;
  price: number;
  category: string;
}

interface CartItem extends MenuItem {
  quantity: number;
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function fetchMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const res = await fetch(`${BASE}/api/menu-items?restaurant_id=${restaurantId}`);
  return res.json();
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function calcTotal(cart: Map<string, CartItem>): number {
  return Array.from(cart.values()).reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export async function openOrderModal(restaurantId: string, restaurantName: string) {
  const items = await fetchMenuItems(restaurantId);
  const cart = new Map<string, CartItem>();

  const modal = document.getElementById("order-modal")!;
  const nameEl = document.getElementById("modal-restaurant-name")!;
  const itemsEl = document.getElementById("modal-items")!;
  const totalEl = document.getElementById("modal-total")!;
  const orderBtn = document.getElementById("modal-order-btn") as HTMLButtonElement;

  nameEl.textContent = restaurantName;

  function updateTotal() {
    const total = calcTotal(cart);
    totalEl.textContent = `Total: ${formatCurrency(total)}`;
    orderBtn.disabled = total === 0;
  }

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

  // Controles de quantidade
  itemsEl.querySelectorAll(".menu-item").forEach((row, idx) => {
    const item = items[idx];
    const qtyEl = row.querySelector(".qty-value")!;

    row.querySelector(".qty-plus")!.addEventListener("click", () => {
      const current = cart.get(item.id);
      const qty = (current?.quantity ?? 0) + 1;
      cart.set(item.id, { ...item, quantity: qty });
      qtyEl.textContent = String(qty);
      updateTotal();
    });

    row.querySelector(".qty-minus")!.addEventListener("click", () => {
      const current = cart.get(item.id);
      if (!current || current.quantity === 0) return;
      const qty = current.quantity - 1;
      if (qty === 0) cart.delete(item.id);
      else cart.set(item.id, { ...item, quantity: qty });
      qtyEl.textContent = String(qty);
      updateTotal();
    });
  });

  updateTotal();
  modal.classList.remove("hidden");

  // Botão fechar
  document.getElementById("modal-close")!.onclick = () => modal.classList.add("hidden");

  // Fazer pedido
  orderBtn.onclick = async () => {
    orderBtn.disabled = true;
    orderBtn.textContent = "Enviando...";

    const userId = localStorage.getItem("user_id") ?? "user-003";
    const cartItems = Array.from(cart.values()).map((i) => ({
      menu_item_id: i.id,
      name: i.name,
      quantity: i.quantity,
      price: i.price,
    }));

    const { data, ms } = await createOrder({
      user_id: userId,
      restaurant_id: restaurantId,
      items: cartItems,
      delivery_address: { street: "Av. Paulista, 1000", city: "São Paulo", lat: -23.561, lon: -46.655 },
    });

    modal.classList.add("hidden");

    const order = data as { id: string; estimated_delivery_at: number };
    const eta = new Date(order.estimated_delivery_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const confirm = document.getElementById("confirm-modal")!;
    document.getElementById("confirm-id")!.textContent = `Pedido #${order.id.slice(0, 8).toUpperCase()}`;
    document.getElementById("confirm-time")!.textContent = `Entrega prevista às ${eta} · criado em ${ms}ms`;
    confirm.classList.remove("hidden");

    document.getElementById("confirm-close")!.onclick = () => confirm.classList.add("hidden");
  };
}
