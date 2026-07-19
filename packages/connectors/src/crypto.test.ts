import { expect, it } from "bun:test";

import { decryptCredential, encryptCredential } from "./crypto";

it("round trips encrypted credentials without storing plaintext", async () => {
  const encrypted = await encryptCredential("secret-token", "test-encryption-key");
  expect(encrypted).not.toContain("secret-token");
  expect(await decryptCredential(encrypted, "test-encryption-key")).toBe("secret-token");
});
