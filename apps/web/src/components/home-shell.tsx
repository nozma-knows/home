"use client";

import { cn } from "@home/ui";
import {
  Bot,
  Brain,
  BriefcaseBusiness,
  ChevronDown,
  CircleDot,
  Inbox,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { ApprovalsView } from "./approvals-view";
import { AuthPanel } from "./auth-panel";
import { AutomationsView } from "./automations-view";
import { BriefingView } from "./briefing-view";
import { DesktopBridge } from "./desktop-bridge";
import { MemoryView } from "./memory-view";
import { SessionsView } from "./sessions-view";
import { SettingsView } from "./settings-view";
import { TriageView } from "./triage-view";

const navigation: ReadonlyArray<{
  id: View;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: "briefing", label: "Briefing", icon: Sparkles },
  { id: "triage", label: "Triage", icon: Inbox },
  { id: "sessions", label: "Sessions", icon: Bot },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "memory", label: "Memory", icon: Brain },
];

type View =
  | "briefing"
  | "triage"
  | "sessions"
  | "automations"
  | "approvals"
  | "memory"
  | "settings";

export function HomeShell() {
  const session = authClient.useSession();
  const [view, setView] = useState<View>("briefing");

  useEffect(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view");
    if (
      ["briefing", "triage", "sessions", "automations", "approvals", "memory", "settings"].includes(
        requestedView ?? "",
      )
    ) {
      setView(requestedView as View);
    }
  }, []);

  function selectView(nextView: View) {
    setView(nextView);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.delete("connected");
    url.searchParams.delete("connection_error");
    window.history.replaceState({}, "", url);
  }

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
      <DesktopBridge />
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
                view === item.id
                  ? "bg-white/[0.07] text-zinc-100"
                  : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
              )}
              key={item.label}
              onClick={() => selectView(item.id)}
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
            onClick={() => selectView("settings")}
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

      <section className="px-5 pb-24 pt-6 sm:px-8 lg:px-12 lg:py-10">
        {view === "triage" ? <TriageView /> : null}
        {view === "sessions" ? <SessionsView /> : null}
        {view === "automations" ? <AutomationsView /> : null}
        {view === "approvals" ? <ApprovalsView /> : null}
        {view === "memory" ? <MemoryView /> : null}
        {view === "settings" ? <SettingsView /> : null}
        {view === "briefing" ? <BriefingView firstName={firstName ?? "there"} /> : null}
      </section>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-white/[0.08] bg-zinc-950/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        {[...navigation, { id: "settings" as const, label: "Settings", icon: Settings }].map(
          (item) => (
            <button
              className={cn(
                "flex min-w-16 flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[9px]",
                view === item.id ? "text-emerald-300" : "text-zinc-600",
              )}
              key={item.id}
              onClick={() => selectView(item.id)}
              type="button"
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ),
        )}
      </nav>
    </main>
  );
}
