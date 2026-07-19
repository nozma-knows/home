"use client";

import { Button, Card, cn } from "@home/ui";
import { Brain, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Memory = {
  id: string;
  kind: "fact" | "preference" | "person" | "project";
  content: string;
  source: string;
  confidence: number;
  updatedAt: string;
};

const kinds = ["fact", "preference", "person", "project"] as const;

export function MemoryView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<Memory["kind"]>("fact");
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const response = await apiClient.v1.memories.$get();
    if (response.ok) setMemories((await response.json()) as Memory[]);
    else setError("Memory could not be loaded");
  }, []);

  useEffect(() => void load(), [load]);

  async function addMemory() {
    if (!content.trim()) return;
    const response = await apiClient.v1.memories.$post({ json: { content, kind, confidence: 1 } });
    if (response.ok) {
      setContent("");
      await load();
    } else setError("Memory could not be saved");
  }

  async function removeMemory(id: string) {
    const response = await apiClient.v1.memories[":id"].$delete({ param: { id } });
    if (response.ok) setMemories((current) => current.filter((memory) => memory.id !== id));
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">Context</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Memory</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Everything home has learned is visible, editable, and removable.
        </p>
      </header>
      {error ? <p className="mt-4 text-xs text-red-300">{error}</p> : null}
      <Card className="mt-8 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-xs text-zinc-400 outline-none"
            onChange={(event) => setKind(event.target.value as Memory["kind"])}
            value={kind}
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-400/30"
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void addMemory()}
            placeholder="Add something home should remember"
            value={content}
          />
          <Button className="gap-2" onClick={() => void addMemory()}>
            <Plus className="size-3.5" /> Remember
          </Button>
        </div>
      </Card>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {memories.map((memory) => (
          <Card className="group p-5" key={memory.id}>
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                <Brain className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500",
                  )}
                >
                  {memory.kind}
                </span>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{memory.content}</p>
                <p className="mt-3 text-[10px] text-zinc-700">
                  {memory.source} · {Math.round(memory.confidence * 100)}% confidence
                </p>
              </div>
              <Button
                className="size-8 p-0 opacity-0 group-hover:opacity-100"
                onClick={() => void removeMemory(memory.id)}
                variant="ghost"
              >
                <Trash2 className="size-3.5 text-red-300" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
