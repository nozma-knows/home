"use client";

import { Button, Card } from "@home/ui";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Newspaper,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type LinkedItem = { id: string; title: string; provider: string; url?: string };
type Briefing = {
  id: string;
  localDate: string;
  headline: string;
  summary: string;
  generatedAt: string;
  sections: {
    priorities: Array<LinkedItem & { reason: string }>;
    waiting: LinkedItem[];
    blocking: LinkedItem[];
    approvals: Array<{ id: string; title: string; type: string }>;
    news: Array<{ id: string; title: string; source: string; why: string; url?: string }>;
  };
};

export function BriefingView({ firstName }: { firstName: string }) {
  const [briefing, setBriefing] = useState<Briefing | null>();
  const [history, setHistory] = useState<Briefing[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [latestResponse, historyResponse] = await Promise.all([
      apiClient.v1.briefings.latest.$get(),
      apiClient.v1.briefings.$get(),
    ]);
    if (latestResponse.ok) setBriefing((await latestResponse.json()) as Briefing | null);
    if (historyResponse.ok) setHistory((await historyResponse.json()) as Briefing[]);
  }, []);

  useEffect(() => void load(), [load]);

  async function generate() {
    setGenerating(true);
    setError(undefined);
    const before = briefing?.generatedAt;
    const response = await apiClient.v1.briefings.generate.$post();
    if (!response.ok) {
      setError("The briefing could not be queued");
      setGenerating(false);
      return;
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const latestResponse = await apiClient.v1.briefings.latest.$get();
      if (!latestResponse.ok) continue;
      const next = (await latestResponse.json()) as Briefing | null;
      if (next && next.generatedAt !== before) {
        setBriefing(next);
        await load();
        setGenerating(false);
        return;
      }
    }
    setGenerating(false);
    setError("Generation is taking longer than expected. This page will refresh when it is ready.");
  }

  const formattedDate = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(briefing ? new Date(`${briefing.localDate}T12:00:00`) : new Date());

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">
            {formattedDate}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Good morning, {firstName}.
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {briefing?.headline ?? "Your day is ready to take shape."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 1 ? (
            <select
              className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs text-zinc-500 outline-none"
              onChange={(event) => {
                const selected = history.find((item) => item.id === event.target.value);
                if (selected) setBriefing(selected);
              }}
              value={briefing?.id ?? ""}
            >
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.localDate}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            className="gap-2"
            disabled={generating}
            onClick={() => void generate()}
            variant="secondary"
          >
            {generating ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {briefing ? "Regenerate" : "Generate briefing"}
          </Button>
        </div>
      </header>

      {error ? <p className="mt-5 text-xs text-amber-300">{error}</p> : null}
      {!briefing ? (
        <Card className="mt-8 grid min-h-80 place-items-center p-8 text-center">
          <div>
            <Sparkles className="mx-auto size-6 text-emerald-400" />
            <h2 className="mt-4 text-lg font-medium text-zinc-200">Build your first briefing</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
              home will combine connected work, RSS feeds, and topics into one focused morning view.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mt-8 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-emerald-400">
              <Sparkles className="size-4" />
              <p className="text-xs font-medium uppercase tracking-[0.16em]">At a glance</p>
            </div>
            <p className="mt-4 text-lg leading-8 text-zinc-300">{briefing.summary}</p>
            <p className="mt-4 text-[10px] text-zinc-700">
              Generated {new Date(briefing.generatedAt).toLocaleString()}
            </p>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="space-y-4">
              <BriefingSection
                empty="No urgent items."
                icon={<CheckCircle2 className="size-4 text-emerald-400" />}
                items={briefing.sections.priorities}
                renderMeta={(item) =>
                  (item as LinkedItem & { reason?: string }).reason ?? item.provider
                }
                title="Top priorities"
              />
              <BriefingSection
                empty="Nothing waiting on you."
                icon={<Clock3 className="size-4 text-amber-300" />}
                items={briefing.sections.waiting}
                renderMeta={(item) => item.provider}
                title="Waiting on you"
              />
            </div>
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Newspaper className="size-4 text-sky-300" />
                <h2 className="text-sm font-medium text-zinc-200">News</h2>
              </div>
              <div className="mt-3 divide-y divide-white/[0.06]">
                {briefing.sections.news.length ? (
                  briefing.sections.news.map((item) => (
                    <a
                      className="group block py-3"
                      href={item.url}
                      key={item.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <p className="text-sm leading-5 text-zinc-300 group-hover:text-white">
                        {item.title}
                      </p>
                      <p className="mt-1.5 text-[10px] text-zinc-600">
                        {item.source} · {item.why}
                      </p>
                    </a>
                  ))
                ) : (
                  <p className="py-8 text-center text-xs text-zinc-700">
                    Add RSS feeds or topics in Settings.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function BriefingSection({
  empty,
  icon,
  items,
  renderMeta,
  title,
}: {
  empty: string;
  icon: React.ReactNode;
  items: LinkedItem[];
  renderMeta: (item: LinkedItem) => string;
  title: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      </div>
      <div className="mt-3 divide-y divide-white/[0.06]">
        {items.length ? (
          items.map((item) => (
            <a
              className="group flex items-start gap-3 py-3"
              href={item.url}
              key={item.id}
              rel="noreferrer"
              target={item.url ? "_blank" : undefined}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-300 group-hover:text-white">{item.title}</p>
                <p className="mt-1 text-[10px] text-zinc-600">{renderMeta(item)}</p>
              </div>
              {item.url ? <ArrowUpRight className="mt-0.5 size-3.5 text-zinc-700" /> : null}
            </a>
          ))
        ) : (
          <p className="py-7 text-center text-xs text-zinc-700">{empty}</p>
        )}
      </div>
    </Card>
  );
}
