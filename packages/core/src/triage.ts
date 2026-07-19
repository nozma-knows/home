export type TriageSignals = {
  ageHours: number;
  isAssigned: boolean;
  isDirectMention: boolean;
  isRead: boolean;
  provider: "gmail" | "slack" | "linear";
};

export function rankTriageItem(signals: TriageSignals) {
  let score = 0;

  if (signals.isDirectMention) score += 45;
  if (signals.isAssigned) score += 35;
  if (!signals.isRead) score += 10;

  score += signals.provider === "linear" ? 8 : signals.provider === "slack" ? 5 : 3;
  score += Math.max(0, 10 - Math.floor(signals.ageHours / 12));

  return Math.min(100, score);
}

export function isTriageItemVisible(status: string, snoozedUntil?: Date | null, now = new Date()) {
  if (status === "done" || status === "archived") return false;
  if (status !== "snoozed") return true;
  return Boolean(snoozedUntil && snoozedUntil <= now);
}
