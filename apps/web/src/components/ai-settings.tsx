"use client";

import { Button, Card } from "@home/ui";
import { Bot, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Provider = "openai" | "anthropic" | "google";
type ProviderAccount = {
  id: string;
  provider: Provider;
  label: string;
  status: string;
};
type Preference = {
  purpose: string;
  providerAccountId: string;
  model: string;
};
type Usage = {
  totals?: { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
};

const providerLabels: Record<Provider, string> = {
  anthropic: "Anthropic",
  google: "Google AI",
  openai: "OpenAI",
};

export function AiSettings() {
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [models, setModels] = useState<Record<Provider, readonly string[]>>({
    anthropic: [],
    google: [],
    openai: [],
  });
  const [usage, setUsage] = useState<Usage>();
  const [provider, setProvider] = useState<Provider>("openai");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [accountsResponse, preferencesResponse, modelsResponse, usageResponse] =
      await Promise.all([
        apiClient.v1["provider-accounts"].$get(),
        apiClient.v1["model-preferences"].$get(),
        apiClient.v1.models.$get(),
        apiClient.v1.usage.$get(),
      ]);
    if (accountsResponse.ok) setAccounts((await accountsResponse.json()) as ProviderAccount[]);
    if (preferencesResponse.ok) setPreferences((await preferencesResponse.json()) as Preference[]);
    if (modelsResponse.ok) setModels((await modelsResponse.json()).models);
    if (usageResponse.ok) setUsage((await usageResponse.json()) as Usage);
  }, []);

  useEffect(() => void load(), [load]);

  async function addAccount() {
    if (!apiKey.trim()) return;
    setPending(true);
    const response = await apiClient.v1["provider-accounts"].$post({
      json: { provider, apiKey, label: label || providerLabels[provider] },
    });
    if (response.ok) {
      setApiKey("");
      setLabel("");
      setError(undefined);
      await load();
    } else {
      const result = await response.json();
      setError("error" in result ? String(result.error) : "Provider account could not be added");
    }
    setPending(false);
  }

  async function removeAccount(account: ProviderAccount) {
    if (!window.confirm(`Remove ${account.label}? Existing transcript history will remain.`))
      return;
    await apiClient.v1["provider-accounts"][":id"].$delete({ param: { id: account.id } });
    await load();
  }

  async function setChatDefault(value: string) {
    const [providerAccountId, model] = value.split(":", 2);
    if (!providerAccountId || !model) return;
    const response = await apiClient.v1["model-preferences"][":purpose"].$put({
      param: { purpose: "chat" },
      json: { providerAccountId, model },
    });
    if (response.ok) await load();
  }

  const chatPreference = preferences.find((preference) => preference.purpose === "chat");

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-zinc-500" />
        <h2 className="text-sm font-medium text-zinc-200">AI providers</h2>
      </div>
      <Card className="mt-4 p-5">
        <div className="grid gap-2 sm:grid-cols-[140px_1fr_1.4fr_auto]">
          <select
            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs text-zinc-400 outline-none"
            onChange={(event) => setProvider(event.target.value as Provider)}
            value={provider}
          >
            {Object.entries(providerLabels).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-zinc-300 outline-none"
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Account label"
            value={label}
          />
          <input
            autoComplete="off"
            className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 font-mono text-xs text-zinc-300 outline-none"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key"
            type="password"
            value={apiKey}
          />
          <Button
            className="gap-2"
            disabled={!apiKey.trim() || pending}
            onClick={() => void addAccount()}
          >
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            Add
          </Button>
        </div>
        {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
        <p className="mt-3 text-[11px] leading-5 text-zinc-600">
          Keys are encrypted before storage and never returned to the browser.
        </p>
        {accounts.length ? (
          <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {accounts.map((account) => (
              <div className="flex items-center gap-3 py-3" key={account.id}>
                <span className="grid size-7 place-items-center rounded-full bg-violet-400/10 text-violet-300">
                  <KeyRound className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-300">{account.label}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-700">
                    {providerLabels[account.provider]} · {account.status}
                  </p>
                </div>
                <Button
                  className="size-8 p-0"
                  onClick={() => void removeAccount(account)}
                  variant="ghost"
                >
                  <Trash2 className="size-3.5 text-red-300" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {accounts.length ? (
        <Card className="mt-3 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-medium text-zinc-300">Default chat model</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                Sessions can override this at any time.
              </p>
            </div>
            <select
              className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs text-zinc-400 outline-none"
              onChange={(event) => void setChatDefault(event.target.value)}
              value={
                chatPreference ? `${chatPreference.providerAccountId}:${chatPreference.model}` : ""
              }
            >
              <option value="">Automatic</option>
              {accounts.flatMap((account) =>
                models[account.provider].map((model) => (
                  <option key={`${account.id}:${model}`} value={`${account.id}:${model}`}>
                    {account.label} · {model}
                  </option>
                )),
              )}
            </select>
          </div>
        </Card>
      ) : null}

      <Card className="mt-3 p-5">
        <p className="text-xs font-medium text-zinc-300">Usage</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Calls" value={String(usage?.totals?.calls ?? 0)} />
          <Metric label="Input tokens" value={(usage?.totals?.inputTokens ?? 0).toLocaleString()} />
          <Metric
            label="Output tokens"
            value={(usage?.totals?.outputTokens ?? 0).toLocaleString()}
          />
          <Metric
            label="Estimated cost"
            value={`$${(usage?.totals?.estimatedCostUsd ?? 0).toFixed(4)}`}
          />
        </div>
      </Card>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-3">
      <p className="font-mono text-sm text-zinc-300">{value}</p>
      <p className="mt-1 text-[10px] text-zinc-700">{label}</p>
    </div>
  );
}
