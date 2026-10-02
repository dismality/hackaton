import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __shiftpilotDb?: Db };

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add your Postgres connection string to .env.local.");
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5), prepare: false });
  return drizzle(client, { schema });
}

export function getDb(): Db {
  if (!globalForDb.__shiftpilotDb) globalForDb.__shiftpilotDb = createDb();
  return globalForDb.__shiftpilotDb;
}

export { schema };
