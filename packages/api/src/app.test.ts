import { describe, expect, it } from "bun:test";

import { type ApiDependencies, createApi } from "./app";

function createTestApi(session: unknown = null) {
  const auth = {
    api: {
      getSession: async () => session,
    },
    handler: async () => new Response("auth handler"),
  } as unknown as ApiDependencies["auth"];

  return createApi({ auth, trustedOrigins: ["http://localhost:3000"] });
}

describe("api", () => {
  it("reports service health without an auth lookup", async () => {
    const response = await createTestApi().request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
  });

  it("allows credentialed CORS from the web origin", async () => {
    const response = await createTestApi().request("/health", {
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not allow an untrusted origin", async () => {
    const response = await createTestApi().request("/health", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("protects user-scoped routes", async () => {
    const response = await createTestApi().request("/v1/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
