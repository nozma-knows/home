import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    prepare: false,
  });

  return drizzle(client, { schema });
}

let database: Database | undefined;

export function getDatabase() {
  if (database) return database;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  database = createDatabase(databaseUrl);
  return database;
}
