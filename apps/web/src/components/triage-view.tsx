"use client";

import { Button, Card, cn } from "@home/ui";
import {
  Archive,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type TriageItem = {
  id: string;
  provider: "gmail" | "slack" | "linear";
  title: string;
  preview: string | null;
  body: string | null;
  externalUrl: string | null;
  participants: string[];
  urgencyScore: number;
  occurredAt: string;
  isDirectMention: boolean;
  isAssigned: boolean;
};

const providerStyles = {
  gmail: { icon: Mail, label: "Gmail", color: "text-red-300 bg-red-400/10" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-violet-300 bg-violet-400/10" },
  linear: { icon: Inbox, label: "Linear", color: "text-sky-300 bg-sky-400/10" },
} as const;

export function TriageView() {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [replying, setReplying] = useState(false);
  const selected = items[selectedIndex];

  const loadItems = useCallback(async () => {
    setLoading(true);
    const response = await apiClient.v1.items.$get();
    if (!response.ok) {
      setError("Could not load your triage feed");
      setLoading(false);
      return;
    }
    const result = (await response.json()) as TriageItem[];
    setItems(result);
    setSelectedIndex((current) => Math.min(current, Math.max(0, result.length - 1)));
    setError(undefined);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const updateStatus = useCallback(
    async (id: string, status: "done" | "archived" | "snoozed") => {
      const snoozedUntil =
        status === "snoozed" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined;
      const response = await apiClient.v1.items[":id"].$patch({
        param: { id },
        json: { status, snoozedUntil },
      });
      if (!response.ok) {
        setError("That triage action could not be saved");
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      setSelectedIndex((current) => Math.max(0, Math.min(current, items.length - 2)));
    },
    [items.length],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.key === "j") setSelectedIndex((value) => Math.min(items.length - 1, value + 1));
      if (event.key === "k") setSelectedIndex((value) => Math.max(0, value - 1));
      if (selected && event.key === "d") void updateStatus(selected.id, "done");
      if (selected && event.key === "e") void updateStatus(selected.id, "archived");
      if (selected && event.key === "s") void updateStatus(selected.id, "snoozed");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, selected, updateStatus]);

  async function sendReply(body: string) {
    if (!selected) return;
    const action = selected.provider === "linear" ? "comment" : "reply";
    const response = await apiClient.v1.items[":id"].actions.$post({
      param: { id: selected.id },
      json: { action, input: { body } },
    });
    if (!response.ok) {
      setError("Your reply could not be queued");
      return;
    }
    setReplying(false);
    await updateStatus(selected.id, "done");
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">
            Unified work queue
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Triage</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Gmail, Slack, and Linear—ranked in one place.
          </p>
        </div>
        <Button className="gap-2" onClick={() => void loadItems()} variant="secondary">
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      {error ? (
        <p className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid min-h-[34rem] overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900/50 lg:grid-cols-[minmax(20rem,0.85fr)_1.4fr]">
        <div className="border-b border-white/[0.07] lg:border-r lg:border-b-0">
          <div className="flex h-12 items-center justify-between border-b border-white/[0.07] px-4 text-xs text-zinc-500">
            <span>{items.length} items</span>
            <span className="hidden font-mono text-[10px] lg:block">
              j/k move · d done · s snooze
            </span>
          </div>
          <div className="max-h-[34rem] overflow-y-auto">
            {loading && !items.length ? (
              <div className="grid h-48 place-items-center">
                <LoaderCircle className="size-5 animate-spin text-emerald-400" />
              </div>
            ) : null}
            {!loading && !items.length ? (
              <div className="px-8 py-16 text-center">
                <Check className="mx-auto size-6 text-emerald-400" />
                <p className="mt-4 text-sm font-medium text-zinc-300">Inbox zero</p>
                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  Connect a provider or wait for the next sync.
                </p>
              </div>
            ) : null}
            {items.map((item, index) => {
              const provider = providerStyles[item.provider];
              const ProviderIcon = provider.icon;
              return (
                <button
                  className={cn(
                    "flex w-full gap-3 border-b border-white/[0.05] p-4 text-left transition",
                    index === selectedIndex ? "bg-white/[0.07]" : "hover:bg-white/[0.035]",
                  )}
                  key={item.id}
                  onClick={() => setSelectedIndex(index)}
                  type="button"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                      provider.color,
                    )}
                  >
                    <ProviderIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-200">
                        {item.title}
                      </span>
                      {item.isDirectMention || item.isAssigned ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
                      ) : null}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                      {item.preview ?? item.body ?? "No preview"}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-3.5 shrink-0 text-zinc-700" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 p-5 sm:p-7">
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>{providerStyles[selected.provider].label}</span>
                    <span>·</span>
                    <span>{new Date(selected.occurredAt).toLocaleString()}</span>
                    <span>·</span>
                    <span>priority {Math.round(selected.urgencyScore)}</span>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-zinc-100">{selected.title}</h2>
                  {selected.participants.length ? (
                    <p className="mt-2 text-xs text-zinc-600">
                      {selected.participants.join(" · ")}
                    </p>
                  ) : null}
                </div>
                {selected.externalUrl ? (
                  <a
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-200"
                    href={selected.externalUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open source <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
              <div className="mt-7 whitespace-pre-wrap text-sm leading-7 text-zinc-400">
                {selected.body ?? selected.preview ?? "No message body available."}
              </div>

              {replying ? (
                <ReplyComposer
                  onCancel={() => setReplying(false)}
                  onSend={(body) => void sendReply(body)}
                />
              ) : (
                <div className="mt-8 flex flex-wrap gap-2 border-t border-white/[0.07] pt-5">
                  <Button className="gap-2" onClick={() => setReplying(true)}>
                    <Send className="size-3.5" /> Reply
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => void updateStatus(selected.id, "done")}
                    variant="secondary"
                  >
                    <Check className="size-3.5" /> Done
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => void updateStatus(selected.id, "snoozed")}
                    variant="secondary"
                  >
                    <Clock3 className="size-3.5" /> Snooze 1 day
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => void updateStatus(selected.id, "archived")}
                    variant="ghost"
                  >
                    <Archive className="size-3.5" /> Archive
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center text-sm text-zinc-600">
              Select an item to inspect it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyComposer({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  return (
    <Card className="mt-8 p-4">
      <textarea
        className="min-h-32 w-full resize-y bg-transparent text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-700"
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a reply…"
        value={body}
      />
      <div className="mt-3 flex justify-end gap-2 border-t border-white/[0.07] pt-3">
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button className="gap-2" disabled={!body.trim()} onClick={() => onSend(body.trim())}>
          <Send className="size-3.5" /> Send
        </Button>
      </div>
    </Card>
  );
}
