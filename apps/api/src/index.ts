import { createApi } from "@home/api";
import { auth } from "@home/auth";
import { JOBS } from "@home/core";
import { getDatabase } from "@home/db";
import { PgBoss } from "pg-boss";

const port = Number(process.env.PORT ?? process.env.HOME_API_PORT ?? 3001);
const trustedOrigins = [
  process.env.WEB_URL ?? "http://localhost:3000",
  ...(process.env.ADDITIONAL_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const boss = new PgBoss({ connectionString: databaseUrl, application_name: "home-api" });
(boss as unknown as EventEmitter).on("error", (error: Error) => {
  console.error("pg-boss error", error);
});
await boss.start();
for (const name of Object.values(JOBS)) {
  await boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 15 });
}

const app = createApi({
  auth,
  database: getDatabase(),
  enqueue: (name, data) => boss.send(name, data),
  trustedOrigins,
});

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`home api listening on ${server.url}`);

async function stop(signal: string) {
  console.log(`home api received ${signal}; stopping`);
  server.stop(true);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

import type { EventEmitter } from "node:events";
