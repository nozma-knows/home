"use client";

import { Button, Card, cn } from "@home/ui";
import { LoaderCircle, Pause, Play, Plus, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Automation = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "suggested" | "active" | "paused";
  trigger: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  actions: Array<{ id: string; type: string; config: Record<string, unknown> }>;
  autonomyLevel: "suggest" | "approve" | "auto";
  allowAutoExternal: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};

type AutomationRun = {
  id: string;
  automationId: string;
  status: string;
  triggerType: string;
  error: string | null;
  createdAt: string;
};

export function AutomationsView() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [suggestions, setSuggestions] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] =
    useState<Omit<Automation, "id" | "status" | "lastRunAt" | "lastError" | "allowAutoExternal">>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [automationResponse, suggestionResponse, runResponse] = await Promise.all([
      apiClient.v1.automations.$get(),
      apiClient.v1.suggestions.$get(),
      apiClient.v1["automation-runs"].$get(),
    ]);
    if (automationResponse.ok) setAutomations((await automationResponse.json()) as Automation[]);
    if (suggestionResponse.ok) setSuggestions((await suggestionResponse.json()) as Automation[]);
    if (runResponse.ok) setRuns((await runResponse.json()) as AutomationRun[]);
  }, []);

  useEffect(() => void load(), [load]);

  async function compile() {
    if (!prompt.trim()) return;
    setPending("compile");
    const response = await apiClient.v1.automations.compile.$post({ json: { prompt } });
    if (response.ok) setDraft((await response.json()) as typeof draft);
    else setError("The automation could not be compiled");
    setPending(undefined);
  }

  async function saveDraft() {
    if (!draft) return;
    setPending("save");
    const response = await apiClient.v1.automations.$post({
      json: {
        name: draft.name,
        description: draft.description ?? undefined,
        status: "active",
        trigger: draft.trigger,
        conditions: draft.conditions,
        actions: draft.actions,
        autonomyLevel: draft.autonomyLevel,
        allowAutoExternal: false,
      },
    });
    if (response.ok) {
      setDraft(undefined);
      setPrompt("");
      await load();
    }
    setPending(undefined);
  }

  async function patchAutomation(automation: Automation, patch: Partial<Automation>) {
    await apiClient.v1.automations[":id"].$patch({
      param: { id: automation.id },
      json: {
        name: patch.name,
        description: patch.description ?? undefined,
        status: patch.status,
        trigger: patch.trigger,
        conditions: patch.conditions,
        actions: patch.actions,
        autonomyLevel: patch.autonomyLevel,
        allowAutoExternal: patch.allowAutoExternal,
      },
    });
    await load();
  }

  async function run(automation: Automation) {
    setPending(automation.id);
    await apiClient.v1.automations[":id"].run.$post({ param: { id: automation.id } });
    window.setTimeout(() => void load(), 1000);
    setPending(undefined);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">Workflows</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Automations</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Describe a routine, review the structured plan, then choose its autonomy.
        </p>
      </header>

      <Card className="mt-8 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-violet-300">
          <WandSparkles className="size-4" />
          <h2 className="text-sm font-medium">Build with natural language</h2>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2.5 text-sm text-zinc-200 outline-none"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void compile()}
            placeholder="Every morning at 8 send my top three priorities"
            value={prompt}
          />
          <Button
            className="gap-2"
            disabled={pending !== undefined || !prompt.trim()}
            onClick={() => void compile()}
          >
            {pending === "compile" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Compile
          </Button>
        </div>
        {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
        {draft ? (
          <div className="mt-4 rounded-xl border border-violet-400/15 bg-violet-400/[0.04] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-200">{draft.name}</p>
                <p className="mt-1 text-xs text-zinc-500">{draft.description}</p>
                <p className="mt-3 font-mono text-[10px] text-zinc-600">
                  {JSON.stringify(draft.trigger)} →{" "}
                  {draft.actions.map((action) => action.type).join(" → ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => setDraft(undefined)} variant="ghost">
                  Cancel
                </Button>
                <Button
                  className="gap-2"
                  disabled={pending !== undefined}
                  onClick={() => void saveDraft()}
                >
                  <Plus className="size-3.5" /> Save active
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {suggestions.length ? (
        <section className="mt-6">
          <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
            Suggestions
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {suggestions.map((suggestion) => (
              <Card className="border-emerald-400/10 p-5" key={suggestion.id}>
                <p className="text-sm font-medium text-zinc-200">{suggestion.name}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-600">{suggestion.description}</p>
                <Button
                  className="mt-4"
                  onClick={async () => {
                    await apiClient.v1.suggestions[":id"].accept.$post({
                      param: { id: suggestion.id },
                    });
                    await load();
                  }}
                  variant="secondary"
                >
                  Accept suggestion
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-3">
          {automations
            .filter((automation) => automation.status !== "suggested")
            .map((automation) => (
              <Card className="p-5" key={automation.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={cn(
                      "mt-1 size-2 rounded-full",
                      automation.status === "active" ? "bg-emerald-400" : "bg-zinc-700",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-zinc-200">{automation.name}</h3>
                      <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] uppercase tracking-wide text-zinc-600">
                        {automation.autonomyLevel}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-600">{automation.description}</p>
                    <p className="mt-3 font-mono text-[10px] text-zinc-700">
                      {JSON.stringify(automation.trigger)}
                    </p>
                    {automation.lastError ? (
                      <p className="mt-2 text-[10px] text-red-300">{automation.lastError}</p>
                    ) : null}
                  </div>
                  <Button
                    className="size-8 p-0"
                    disabled={pending !== undefined}
                    onClick={() => void run(automation)}
                    variant="ghost"
                  >
                    {pending === automation.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    className="size-8 p-0"
                    onClick={() =>
                      void patchAutomation(automation, {
                        status: automation.status === "active" ? "paused" : "active",
                      })
                    }
                    variant="ghost"
                  >
                    {automation.status === "active" ? (
                      <Pause className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    className="size-8 p-0"
                    onClick={async () => {
                      await apiClient.v1.automations[":id"].$delete({
                        param: { id: automation.id },
                      });
                      await load();
                    }}
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5 text-red-300" />
                  </Button>
                </div>
              </Card>
            ))}
        </div>
        <Card className="h-fit p-5">
          <h2 className="text-sm font-medium text-zinc-200">Recent runs</h2>
          <div className="mt-3 divide-y divide-white/[0.06]">
            {runs.slice(0, 12).map((run) => (
              <div className="py-3" key={run.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-zinc-400">{run.triggerType}</p>
                  <span
                    className={cn(
                      "text-[9px] uppercase",
                      run.status === "failed"
                        ? "text-red-300"
                        : run.status === "waiting"
                          ? "text-amber-300"
                          : "text-emerald-400",
                    )}
                  >
                    {run.status}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-700">
                  {new Date(run.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
