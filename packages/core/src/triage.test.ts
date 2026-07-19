import { describe, expect, it } from "bun:test";

import { isTriageItemVisible, rankTriageItem } from "./triage";

describe("triage ranking", () => {
  it("ranks direct assigned work above passive unread work", () => {
    const direct = rankTriageItem({
      ageHours: 1,
      isAssigned: true,
      isDirectMention: true,
      isRead: false,
      provider: "linear",
    });
    const passive = rankTriageItem({
      ageHours: 1,
      isAssigned: false,
      isDirectMention: false,
      isRead: false,
      provider: "gmail",
    });

    expect(direct).toBeGreaterThan(passive);
  });

  it("hides snoozed items until their wake time", () => {
    const now = new Date("2026-07-19T12:00:00Z");
    expect(isTriageItemVisible("snoozed", new Date("2026-07-19T13:00:00Z"), now)).toBe(false);
    expect(isTriageItemVisible("snoozed", new Date("2026-07-19T11:00:00Z"), now)).toBe(true);
  });
});
