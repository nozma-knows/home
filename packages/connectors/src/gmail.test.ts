import { expect, test } from "bun:test";

import { gmailConnector } from "./gmail";

test("gmail incremental sync converts millisecond cursors to epoch seconds", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("format=metadata")) {
      return Response.json({
        id: "message-1",
        threadId: "thread-1",
        internalDate: "1712345678999",
        payload: { headers: [{ name: "Subject", value: "Test" }] },
      });
    }
    return Response.json({ messages: [{ id: "message-1" }] });
  }) as typeof fetch;

  try {
    const result = await gmailConnector.sync({
      accessToken: "token",
      cursor: { historyId: "1712345678000" },
      metadata: {},
    });
    const listURL = new URL(requested[0] ?? "");
    expect(listURL.searchParams.get("q")).toBe("after:1712345678");
    expect(result.cursor).toEqual({ receivedAtMs: "1712345678999" });
    expect(result.items).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
