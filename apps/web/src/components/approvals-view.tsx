"use client";

import { Button, Card, cn } from "@home/ui";
import { Check, Clock3, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Approval = {
  id: string;
  title: string;
  description: string | null;
  actionType: string;
  payload: Record<string, unknown>;
  status: string;
  expiresAt: string;
  createdAt: string;
};

export function ApprovalsView() {
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const load = useCallback(async () => {
    const response = await apiClient.v1.approvals.$get();
    if (response.ok) setApprovals((await response.json()) as Approval[]);
  }, []);

  useEffect(() => void load(), [load]);

  async function decide(approval: Approval, decision: "approve" | "reject") {
    if (decision === "approve") {
      await apiClient.v1.approvals[":id"].approve.$post({
        param: { id: approval.id },
        json: {},
      });
    } else {
      await apiClient.v1.approvals[":id"].reject.$post({ param: { id: approval.id } });
    }
    await load();
  }

  const pending = approvals.filter((approval) => approval.status === "pending");

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">
          Safety gate
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Approvals</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Review outward-facing and high-impact actions before they run.
        </p>
      </header>
      <div className="mt-8 space-y-3">
        {pending.length ? (
          pending.map((approval) => (
            <Card className="p-5" key={approval.id}>
              <div className="flex items-start gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
                  <ShieldCheck className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium text-zinc-200">{approval.title}</h2>
                    <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[9px] uppercase tracking-wide text-zinc-600">
                      {approval.actionType}
                    </span>
                  </div>
                  {approval.description ? (
                    <p className="mt-2 text-xs text-zinc-600">{approval.description}</p>
                  ) : null}
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/25 p-3 font-mono text-[10px] leading-5 text-zinc-600">
                    {JSON.stringify(approval.payload, null, 2)}
                  </pre>
                  <p className="mt-3 flex items-center gap-1 text-[10px] text-zinc-700">
                    <Clock3 className="size-3" /> Expires{" "}
                    {new Date(approval.expiresAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button className="gap-1.5" onClick={() => void decide(approval, "approve")}>
                    <Check className="size-3.5" /> Approve
                  </Button>
                  <Button
                    className="gap-1.5"
                    onClick={() => void decide(approval, "reject")}
                    variant="secondary"
                  >
                    <X className="size-3.5" /> Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <Card className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <Check className="mx-auto size-5 text-emerald-400" />
              <p className="mt-3 text-sm text-zinc-300">No pending approvals</p>
              <p className="mt-1 text-xs text-zinc-700">Governed actions will appear here.</p>
            </div>
          </Card>
        )}
      </div>
      {approvals.some((approval) => approval.status !== "pending") ? (
        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-zinc-700">History</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {approvals
              .filter((approval) => approval.status !== "pending")
              .slice(0, 20)
              .map((approval) => (
                <span
                  className={cn("rounded-full bg-white/[0.04] px-3 py-1 text-[10px] text-zinc-600")}
                  key={approval.id}
                >
                  {approval.title} · {approval.status}
                </span>
              ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
