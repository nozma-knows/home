import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type AiProvider = "openai" | "anthropic" | "google";
export type ModelPurpose =
  | "chat"
  | "briefing"
  | "distillation"
  | "urgency_scoring"
  | "classification"
  | "automation_default";

export type AvailableAccount = {
  id: string;
  provider: AiProvider;
  status: string;
};

export type ModelPreference = {
  purpose: ModelPurpose;
  providerAccountId: string;
  model: string;
};

export type ModelResolution = {
  account: AvailableAccount;
  model: string;
  source: "call_site" | "purpose" | "fallback";
  substitutionReason?: string;
};

const DEFAULT_MODELS: Record<AiProvider, Record<"frontier" | "fast", string>> = {
  anthropic: { frontier: "claude-sonnet-4-5", fast: "claude-haiku-4-5" },
  google: { frontier: "gemini-2.5-pro", fast: "gemini-2.5-flash" },
  openai: { frontier: "gpt-5", fast: "gpt-5-mini" },
};

const PURPOSE_TIERS: Record<ModelPurpose, "frontier" | "fast"> = {
  automation_default: "fast",
  briefing: "frontier",
  chat: "frontier",
  classification: "fast",
  distillation: "fast",
  urgency_scoring: "fast",
};

export function resolveModel(input: {
  accounts: AvailableAccount[];
  callSite?: { providerAccountId?: string; model?: string };
  preferences: ModelPreference[];
  purpose: ModelPurpose;
}): ModelResolution {
  const activeAccounts = input.accounts.filter((account) => account.status === "active");
  if (!activeAccounts.length) throw new Error("Connect an AI provider before running a model");

  if (input.callSite?.providerAccountId && input.callSite.model) {
    const account = activeAccounts.find(
      (candidate) => candidate.id === input.callSite?.providerAccountId,
    );
    if (account) return { account, model: input.callSite.model, source: "call_site" };
  }

  const preference = input.preferences.find((candidate) => candidate.purpose === input.purpose);
  if (preference) {
    const account = activeAccounts.find(
      (candidate) => candidate.id === preference.providerAccountId,
    );
    if (account) return { account, model: preference.model, source: "purpose" };
  }

  const account = activeAccounts[0];
  if (!account) throw new Error("Connect an AI provider before running a model");
  return {
    account,
    model: DEFAULT_MODELS[account.provider][PURPOSE_TIERS[input.purpose]],
    source: "fallback",
    substitutionReason: preference
      ? "Preferred provider account is unavailable"
      : "No purpose preference configured",
  };
}

export function createProviderModel(input: {
  apiKey: string;
  model: string;
  provider: AiProvider;
}): LanguageModel {
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey })(input.model);
  }
  if (input.provider === "google") {
    return createGoogleGenerativeAI({ apiKey: input.apiKey })(input.model);
  }
  return createOpenAI({ apiKey: input.apiKey })(input.model);
}

export function estimateCostUsd(input: {
  inputTokens: number;
  outputTokens: number;
  provider: AiProvider;
}) {
  const perMillion = {
    anthropic: { input: 3, output: 15 },
    google: { input: 1.25, output: 10 },
    openai: { input: 1.25, output: 10 },
  }[input.provider];
  return (
    (input.inputTokens * perMillion.input + input.outputTokens * perMillion.output) / 1_000_000
  );
}
