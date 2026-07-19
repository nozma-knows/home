import type { EventEmitter } from "node:events";
import { PgBoss } from "pg-boss";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const workerName = process.env.WORKER_NAME ?? "home-worker";
const boss = new PgBoss({
  connectionString: databaseUrl,
  application_name: workerName,
});

(boss as unknown as EventEmitter).on("error", (error: Error) => {
  console.error("pg-boss error", error);
});

await boss.start();
console.log(`${workerName} started`);

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${workerName} received ${signal}; stopping`);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
