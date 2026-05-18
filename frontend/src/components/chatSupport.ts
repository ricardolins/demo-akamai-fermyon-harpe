// ============================================================
// CHAT DE SUPORTE — frontend/src/components/chatSupport.ts
//
// Widget flutuante de suporte ao cliente com IA.
// Chama o vLLM (Mistral 7B) rodando na Akamai Cloud.
//
// Fluxo:
//   1. Botão flutuante no canto inferior direito
//   2. Abre painel de chat ao clicar
//   3. Usuário digita → POST /v1/chat/completions com stream:true
//   4. Tokens chegam via SSE e são escritos na bolha em tempo real
// ============================================================

const LLM_BASE = import.meta.env.VITE_LLM_BASE ?? "http://172.238.162.106:8000";
const MODEL    = "mistralai/Mistral-7B-Instruct-v0.3";

// Contexto de sistema: define o papel do assistente para o LLM
const SYSTEM_PROMPT = `Você é um assistente de suporte ao cliente do FoodEdge,
um aplicativo de delivery de comida. Seu papel é ajudar usuários com:
- Rastreamento de pedidos
- Cancelamentos e reembolsos
- Problemas com pagamento
- Reclamações sobre entrega
- Dúvidas sobre o cardápio e restaurantes
- Promoções e cupons

Seja simpático, objetivo e responda sempre em português do Brasil.
Se não souber a resposta, oriente o usuário a entrar em contato pelo telefone 0800-123-4567.
Mantenha as respostas curtas (máximo 3 parágrafos).`;

// Representa uma mensagem no histórico da conversa
interface Message {
  role: "user" | "assistant";
  content: string;
}

// Histórico completo da conversa (mantido em memória durante a sessão)
const history: Message[] = [];

// ============================================================
// FUNÇÕES DE RENDERIZAÇÃO
// ============================================================

// Adiciona uma bolha de mensagem no painel de chat
function appendMessage(role: "user" | "assistant", content: string): HTMLElement {
  const messages = document.getElementById("chat-messages")!;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;
  bubble.textContent = content;

  messages.appendChild(bubble);
  // Rola automaticamente para a última mensagem
  messages.scrollTop = messages.scrollHeight;

  return bubble;
}

// Cria bolha vazia do assistente — os tokens do SSE vão sendo escritos nela
function createAssistantBubble(): HTMLElement {
  const messages = document.getElementById("chat-messages")!;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--assistant";
  bubble.textContent = "▌";
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

// ============================================================
// STREAMING SSE DA API DO vLLM
// ============================================================

// Envia a mensagem e escreve os tokens em tempo real na bolha fornecida.
async function streamToLLM(userMessage: string, bubble: HTMLElement): Promise<void> {
  history.push({ role: "user", content: userMessage });

  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
      ],
      max_tokens: 200,
      temperature: 0.7,
      stream: true,
    }),
  });

  if (!res.ok) throw new Error(`LLM error: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const messagesEl = document.getElementById("chat-messages")!;
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;

      try {
        const chunk = JSON.parse(payload);
        const token: string | undefined = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          bubble.textContent = fullText;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      } catch {
        // fragmento SSE incompleto — ignorar
      }
    }
  }

  history.push({ role: "assistant", content: fullText });
}

// ============================================================
// HANDLER DE ENVIO DE MENSAGEM
// ============================================================
async function handleSend() {
  const input   = document.getElementById("chat-input") as HTMLInputElement;
  const sendBtn = document.getElementById("chat-send") as HTMLButtonElement;

  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;

  appendMessage("user", text);

  // Cria bolha vazia — tokens chegam via SSE e são escritos em tempo real
  const bubble = createAssistantBubble();

  try {
    await streamToLLM(text, bubble);
    if (bubble.textContent === "▌") bubble.textContent = "";
  } catch {
    bubble.textContent = "Desculpe, não consegui processar sua mensagem. Tente novamente ou ligue 0800-123-4567.";
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============================================================
// INICIALIZAÇÃO — chamada uma vez por main.ts
// ============================================================
export function initChatSupport() {
  const toggleBtn = document.getElementById("chat-toggle")!;
  const panel     = document.getElementById("chat-panel")!;
  const closeBtn  = document.getElementById("chat-close")!;
  const sendBtn   = document.getElementById("chat-send")!;
  const input     = document.getElementById("chat-input") as HTMLInputElement;

  // Abre/fecha o painel ao clicar no botão flutuante
  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      input.focus();

      // Exibe mensagem de boas-vindas na primeira abertura
      const messages = document.getElementById("chat-messages")!;
      if (messages.children.length === 0) {
        appendMessage("assistant", "Olá! 👋 Sou o assistente de suporte do FoodEdge. Como posso te ajudar hoje?");
      }
    }
  });

  // Fecha o painel com o botão X
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  // Envia mensagem ao clicar no botão
  sendBtn.addEventListener("click", handleSend);

  // Envia mensagem ao pressionar Enter (sem Shift)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}
