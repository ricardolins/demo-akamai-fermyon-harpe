export interface HarperConfig {
  url: string;
  username: string;
  password: string;
  schema: string;
}

export class HarperClient {
  private headers: HeadersInit;
  private baseUrl: string;
  private schema: string;

  constructor(config: HarperConfig) {
    this.baseUrl = config.url;
    this.schema = config.schema;
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
    };
  }

  async query<T>(sql: string): Promise<T[]> {
    const res = await fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ operation: "sql", sql }),
    });
    if (!res.ok) throw new Error(`HarperDB error: ${res.status}`);
    return res.json();
  }

  async insert<T extends object>(table: string, records: T[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        operation: "insert",
        schema: this.schema,
        table,
        records,
      }),
    });
    if (!res.ok) throw new Error(`HarperDB insert error: ${res.status}`);
  }

  async upsert<T extends object>(table: string, records: T[]): Promise<void> {
    const res = await fetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        operation: "upsert",
        schema: this.schema,
        table,
        records,
      }),
    });
    if (!res.ok) throw new Error(`HarperDB upsert error: ${res.status}`);
  }

  async getById<T>(table: string, id: string): Promise<T | null> {
    const rows = await this.query<T>(
      `SELECT * FROM ${this.schema}.${table} WHERE id = '${id}' LIMIT 1`
    );
    return rows[0] ?? null;
  }
}

export function createHarperClient(): HarperClient {
  return new HarperClient({
    url: process.env.HARPER_URL ?? "http://localhost:9925",
    username: process.env.HARPER_USER ?? "HDB_ADMIN",
    password: process.env.HARPER_PASS ?? "password",
    schema: "foodedge",
  });
}
