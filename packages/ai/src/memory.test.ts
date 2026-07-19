import { expect, it } from "bun:test";

import { findMemoryDuplicate } from "./memory";

it("deduplicates strongly overlapping memories of the same kind", () => {
  const duplicate = findMemoryDuplicate(
    { content: "Noah prefers concise daily briefings", kind: "preference" },
    [
      { content: "Noah prefers concise briefings every day", kind: "preference" },
      { content: "Noah works on the Home project", kind: "project" },
    ],
  );
  expect(duplicate?.kind).toBe("preference");
});
