import { createHarperClient } from "../lib/client.ts";
import { restaurants } from "./restaurants.ts";
import { users } from "./users.ts";
import { menuItems } from "./menu_items.ts";

async function createSchema(client: ReturnType<typeof createHarperClient>) {
  const schemas = ["restaurants", "orders", "users", "menu_items"];
  for (const table of schemas) {
    await client["query"](`CREATE TABLE IF NOT EXISTS foodedge.${table} (id VARCHAR(36) NOT NULL)`).catch(() => {});
  }
}

async function seed() {
  const client = createHarperClient();

  console.log("Creating schema...");
  await createSchema(client);

  console.log("Seeding restaurants...");
  await client.upsert("restaurants", restaurants);

  console.log("Seeding users...");
  await client.upsert("users", users);

  console.log("Seeding menu items...");
  await client.upsert("menu_items", menuItems);

  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
