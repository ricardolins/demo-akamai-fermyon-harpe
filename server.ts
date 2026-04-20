// ============================================================
// SERVIDOR DE DESENVOLVIMENTO LOCAL — server.ts
//
// Simula a edge function localmente usando Hono + Node.js.
// Usado durante o desenvolvimento para testar sem fazer deploy na Akamai.
//
// DIFERENÇA para produção:
//   Dev:  Node.js na sua máquina → Hono roteia → handlers em /functions/
//   Prod: Akamai WASM no edge → itty-router roteia → spin-app/src/index.ts
//
// Os handlers em /functions/ e em spin-app/src/index.ts fazem a mesma coisa,
// mas o código é duplicado porque o WASM não pode usar módulos Node.js.
// ============================================================

// Hono é um framework web ultra-leve compatível com múltiplos runtimes
// (Node.js, Cloudflare Workers, Bun, Deno). A API é similar ao Express.js.
import { serve } from "@hono/node-server"; // adaptador para rodar Hono no Node.js
import { Hono } from "hono";
import { cors } from "hono/cors";     // middleware de CORS (permite o browser fazer fetch para outro domínio)
import { logger } from "hono/logger"; // middleware que imprime requisições no terminal

// Handlers separados por domínio (menu, orders, geo, personalization)
// Cada arquivo exporta uma função que recebe Request e retorna Promise<Response>
import { handleMenu }            from "./functions/menu/index.ts";
import { handleMenuItems }       from "./functions/menu/items.ts";
import { handleOrders }          from "./functions/orders/index.ts";
import { handlePersonalization } from "./functions/personalization/index.ts";
import { handleGeo }             from "./functions/geo/index.ts";

const app = new Hono();

// app.use("*", ...) registra middleware para TODAS as rotas
// logger() imprime cada requisição: método, URL, status, tempo
app.use("*", logger());

// cors() adiciona headers "Access-Control-Allow-Origin: *" nas respostas,
// necessário porque o Vite (frontend) roda em localhost:5173 e faz fetch para localhost:3000
// (domínios diferentes = CORS bloqueado sem esses headers)
app.use("*", cors());

// Cada rota passa c.req.raw (objeto Request nativo da Web API) para o handler.
// Por que .raw? Hono tem seu próprio tipo Request, mas os handlers foram escritos
// para a Web API padrão (compatível com o WASM). .raw acessa o Request nativo.
app.get("/api/menu",            (c) => handleMenu(c.req.raw));
app.get("/api/menu-items",      (c) => handleMenuItems(c.req.raw));
app.get("/api/personalization", (c) => handlePersonalization(c.req.raw));
app.get("/api/geo",             (c) => handleGeo(c.req.raw));
app.post("/api/orders",         (c) => handleOrders(c.req.raw));
app.get("/api/orders/:id",      (c) => handleOrders(c.req.raw));

// Rota de health check — confirma que o servidor está rodando
app.get("/", (c) => c.text("FoodEdge dev server — OK"));

// parseInt converte string para inteiro (PORT pode ser "3000" no .env)
const port = parseInt(process.env.PORT ?? "3000");

// serve() inicia o servidor HTTP do Node.js com o handler do Hono.
// O callback é chamado quando o servidor está pronto para aceitar conexões.
serve({ fetch: app.fetch, port }, () => {
  console.log(`FoodEdge server running at http://localhost:${port}`);
});
