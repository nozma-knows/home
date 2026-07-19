import { createApi } from "@home/api";
import { auth } from "@home/auth";

const port = Number(process.env.PORT ?? process.env.HOME_API_PORT ?? 3001);
const trustedOrigins = [
  process.env.WEB_URL ?? "http://localhost:3000",
  ...(process.env.ADDITIONAL_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const app = createApi({ auth, trustedOrigins });

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`home api listening on ${server.url}`);
