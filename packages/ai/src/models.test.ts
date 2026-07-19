import { describe, expect, it } from "bun:test";

import { resolveModel } from "./models";

const accounts = [
  { id: "openai-1", provider: "openai" as const, status: "active" },
  { id: "anthropic-1", provider: "anthropic" as const, status: "active" },
];

describe("model resolver", () => {
  it("uses a valid call-site model before a purpose preference", () => {
    const result = resolveModel({
      accounts,
      callSite: { providerAccountId: "anthropic-1", model: "claude-custom" },
      preferences: [{ purpose: "chat", providerAccountId: "openai-1", model: "gpt-custom" }],
      purpose: "chat",
    });
    expect(result.source).toBe("call_site");
    expect(result.model).toBe("claude-custom");
  });

  it("falls back when a preferred account is unavailable", () => {
    const result = resolveModel({
      accounts: accounts.slice(0, 1),
      preferences: [{ purpose: "chat", providerAccountId: "missing", model: "claude-custom" }],
      purpose: "chat",
    });
    expect(result.source).toBe("fallback");
    expect(result.substitutionReason).toContain("unavailable");
  });
});
