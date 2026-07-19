import type { Auth } from "@home/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

type Variables = {
  session: Auth["$Infer"]["Session"]["session"] | null;
  user: Auth["$Infer"]["Session"]["user"] | null;
};

export type ApiDependencies = {
  auth: Pick<Auth, "api" | "handler">;
  trustedOrigins: string[];
};

export function createApi({ auth, trustedOrigins }: ApiDependencies) {
  const app = new Hono<{ Variables: Variables }>();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => (trustedOrigins.includes(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Content-Length", "X-Request-Id"],
      maxAge: 600,
      credentials: true,
    }),
  );

  app.use("/v1/*", async (context, next) => {
    const result = await auth.api.getSession({ headers: context.req.raw.headers });
    context.set("user", result?.user ?? null);
    context.set("session", result?.session ?? null);
    await next();
  });

  const routes = app
    .get("/health", (context) =>
      context.json({
        status: "ok" as const,
        service: "api" as const,
        timestamp: new Date().toISOString(),
      }),
    )
    .on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw))
    .get("/v1/me", (context) => {
      const user = context.get("user");
      const session = context.get("session");

      if (!user || !session) {
        return context.json({ error: "Unauthorized" as const }, 401);
      }

      return context.json({ user, session });
    });

  app.notFound((context) => context.json({ error: "Not found" as const }, 404));
  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "Internal server error" as const }, 500);
  });

  return routes;
}
