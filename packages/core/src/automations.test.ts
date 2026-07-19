import { describe, expect, it } from "bun:test";

import { compileAutomationPrompt, matchesConditions, requiresApproval } from "./automations";

describe("automation autonomy", () => {
  it("keeps outward actions behind approval unless explicitly overridden", () => {
    expect(
      requiresApproval({ actionType: "reply", autonomyLevel: "auto", allowAutoExternal: false }),
    ).toBe(true);
    expect(
      requiresApproval({ actionType: "reply", autonomyLevel: "auto", allowAutoExternal: true }),
    ).toBe(false);
  });

  it("matches deterministic item filters", () => {
    expect(
      matchesConditions({ provider: "gmail", title: "Quarterly plan" }, [
        { field: "title", operator: "contains", value: "plan" },
      ]),
    ).toBe(true);
  });

  it("compiles a natural-language schedule into reviewable data", () => {
    const automation = compileAutomationPrompt("Every morning at 8 send my top priorities");
    expect(automation.trigger).toEqual({ type: "schedule", cron: "0 8 * * *" });
    expect(automation.autonomyLevel).toBe("approve");
  });
});
