"use client";

import { Button, Card, cn } from "@home/ui";
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Inbox,
  LogOut,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

import { AuthPanel } from "./auth-panel";

const navigation: ReadonlyArray<{
  label: string;
  icon: typeof Sparkles;
  active?: boolean;
}> = [
  { label: "Briefing", icon: Sparkles, active: true },
  { label: "Triage", icon: Inbox },
  { label: "Sessions", icon: Bot },
  { label: "Automations", icon: Workflow },
];

export function HomeShell() {
  const session = authClient.useSession();
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    let active = true;

    apiClient.health
      .$get()
      .then((response) => {
        if (active) setApiStatus(response.ok ? "online" : "offline");
      })
      .catch(() => {
        if (active) setApiStatus("offline");
      });

    return () => {
      active = false;
    };
  }, []);

  if (session.isPending) {
    return (
      <main className="grid min-h-screen place-items-center">
        <CircleDot className="size-5 animate-pulse text-emerald-400" />
      </main>
    );
  }

  if (!session.data) {
    return (
      <main className="grid min-h-screen place-items-center px-5 py-12">
        <div className="w-full">
          <div className="mx-auto mb-8 flex w-fit items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-emerald-400 font-mono text-xs font-bold text-zinc-950">
              h
            </span>
            home
          </div>
          <AuthPanel />
        </div>
      </main>
    );
  }

  const firstName = session.data.user.name.split(" ")[0];

  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden min-h-screen border-r border-white/[0.06] bg-black/20 p-4 lg:flex lg:flex-col">
        <div className="flex h-11 items-center gap-2 px-2 text-sm font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-emerald-400 font-mono text-xs font-bold text-zinc-950">
            h
          </span>
          home
        </div>

        <button
          className="mt-5 flex h-10 items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-left text-sm text-zinc-300"
          type="button"
        >
          <span className="flex min-w-0 items-center gap-2">
            <BriefcaseBusiness className="size-4 shrink-0 text-zinc-500" />
            <span className="truncate">Personal</span>
          </span>
          <ChevronDown className="size-3.5 text-zinc-600" />
        </button>

        <nav className="mt-4 space-y-1">
          {navigation.map((item) => (
            <button
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition",
                item.active
                  ? "bg-white/[0.07] text-zinc-100"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
              )}
              key={item.label}
              type="button"
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-1">
          <button
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-300"
            type="button"
          >
            <Settings className="size-4" />
            Settings
          </button>
          <button
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition hover:bg-white/[0.04]"
            onClick={() => void authClient.signOut()}
            type="button"
          >
            <span className="grid size-7 place-items-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-300">
              {firstName?.[0]?.toUpperCase() ?? "U"}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
              {session.data.user.email}
            </span>
            <LogOut className="size-3.5 text-zinc-600" />
          </button>
        </div>
      </aside>

      <section className="px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
        <header className="mx-auto flex max-w-5xl items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">
              Sunday · Foundation
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Good morning, {firstName}.
            </h1>
            <p className="mt-2 text-sm text-zinc-500">Your command center is ready to connect.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-500">
            <span
              className={cn(
                "size-1.5 rounded-full",
                apiStatus === "online"
                  ? "bg-emerald-400"
                  : apiStatus === "offline"
                    ? "bg-red-400"
                    : "animate-pulse bg-amber-400",
              )}
            />
            API {apiStatus}
          </div>
        </header>

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card className="min-h-80 p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
                  Morning briefing
                </p>
                <h2 className="mt-2 text-lg font-medium text-zinc-200">Nothing connected yet</h2>
              </div>
              <Sparkles className="size-5 text-emerald-400/70" />
            </div>
            <div className="mt-12 max-w-md">
              <p className="text-sm leading-6 text-zinc-500">
                Connect Gmail, Slack, and Linear to build your first briefing and unified triage
                feed. Connector work begins in Phase 2.
              </p>
              <Button className="mt-6" variant="secondary">
                View foundation status
              </Button>
            </div>
          </Card>

          <div className="grid gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-400">
                  <CheckCircle2 className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">Account secured</p>
                  <p className="mt-0.5 text-xs text-zinc-600">Better Auth session active</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-violet-400/10 text-violet-300">
                  <BriefcaseBusiness className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">Organizations ready</p>
                  <p className="mt-0.5 text-xs text-zinc-600">Personal scope is the default</p>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
                  <Bot className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">Agent layer planned</p>
                  <p className="mt-0.5 text-xs text-zinc-600">Hosted sessions arrive in Phase 3</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}
