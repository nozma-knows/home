export type AutonomyLevel = "suggest" | "approve" | "auto";

const EXTERNAL_ACTIONS = new Set(["send", "post", "reply", "comment", "connector_action"]);

export function requiresApproval(input: {
  actionType: string;
  allowAutoExternal?: boolean;
  autonomyLevel: AutonomyLevel;
}) {
  if (input.autonomyLevel !== "auto") return true;
  return EXTERNAL_ACTIONS.has(input.actionType) && !input.allowAutoExternal;
}

export function matchesConditions(
  item: Record<string, unknown>,
  conditions: Array<{
    field: string;
    operator: "equals" | "contains" | "is";
    value: string | boolean;
  }>,
) {
  return conditions.every((condition) => {
    const actual = item[condition.field];
    if (condition.operator === "contains") {
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(condition.value).toLowerCase());
    }
    return actual === condition.value || String(actual) === String(condition.value);
  });
}

export function compileAutomationPrompt(prompt: string) {
  const normalized = prompt.trim();
  const scheduleMatch = normalized.match(/every\s+(morning|day)(?:\s+at\s+(\d{1,2}))?/i);
  const trigger = scheduleMatch
    ? { type: "schedule" as const, cron: `0 ${Number(scheduleMatch[2] ?? 7)} * * *` }
    : { type: "manual" as const };
  const outward = /send|reply|post|comment|dm\b/i.test(normalized);
  return {
    name: normalized.slice(0, 72),
    description: normalized,
    trigger,
    conditions: [],
    actions: [
      {
        id: crypto.randomUUID(),
        type: outward ? ("connector_action" as const) : ("notify" as const),
        config: { instruction: normalized },
      },
    ],
    autonomyLevel: "approve" as const,
  };
}
