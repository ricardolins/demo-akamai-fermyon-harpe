import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { handleMenu } from "./functions/menu/index.ts";
import { handleMenuItems } from "./functions/menu/items.ts";
import { handleOrders } from "./functions/orders/index.ts";
import { handlePersonalization } from "./functions/personalization/index.ts";
import { handleGeo } from "./functions/geo/index.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.get("/api/menu", (c) => handleMenu(c.req.raw));
app.get("/api/menu-items", (c) => handleMenuItems(c.req.raw));
app.get("/api/personalization", (c) => handlePersonalization(c.req.raw));
app.get("/api/geo", (c) => handleGeo(c.req.raw));
app.post("/api/orders", (c) => handleOrders(c.req.raw));
app.get("/api/orders/:id", (c) => handleOrders(c.req.raw));

app.get("/", (c) => c.text("FoodEdge dev server — OK"));

const port = parseInt(process.env.PORT ?? "3000");
serve({ fetch: app.fetch, port }, () => {
  console.log(`FoodEdge server running at http://localhost:${port}`);
});
