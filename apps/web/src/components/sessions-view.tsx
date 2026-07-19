"use client";

import { Button, Card, cn } from "@home/ui";
import {
  Bot,
  ChevronDown,
  GitFork,
  LoaderCircle,
  Mic,
  Paperclip,
  Plus,
  Send,
  Settings2,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiClient } from "@/lib/api-client";

type ProviderAccount = {
  id: string;
  provider: "openai" | "anthropic" | "google";
  label: string;
  status: string;
};

type AgentSession = {
  id: string;
  title: string;
  status: "idle" | "queued" | "running" | "waiting" | "failed";
  providerAccountId: string | null;
  modelOverride: string | null;
  effort: string;
  mode: "plan" | "ask" | "auto";
  enabledToolsets: string[];
  lastError: string | null;
  lastActivityAt: string;
};

type SessionEvent = {
  id: string;
  sequence: number;
  type: string;
  role: string | null;
  content: string | null;
  model: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

type PendingAttachment = {
  id: string;
  fileName: string;
};
type PlanArtifact = {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  updatedAt: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  start(): void;
  stop(): void;
};

async function notifySessionComplete(title: string) {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title: "home", body: `${title} is ready.` });
    return;
  } catch {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("home", { body: `${title} is ready.` });
    }
  }
}

export function SessionsView() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [models, setModels] = useState<Record<string, readonly string[]>>({});
  const [activeId, setActiveId] = useState<string>();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [plans, setPlans] = useState<PlanArtifact[]>([]);
  const [listening, setListening] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const recognition = useRef<SpeechRecognitionLike | undefined>(undefined);
  const previousStatuses = useRef<Record<string, AgentSession["status"]>>({});

  const active = sessions.find((session) => session.id === activeId);
  const activeAccount = accounts.find((account) => account.id === active?.providerAccountId);
  const modelOptions = activeAccount ? (models[activeAccount.provider] ?? []) : [];

  const startDictation = useCallback(() => {
    if (recognition.current && listening) {
      recognition.current.stop();
      return;
    }
    const SpeechRecognition =
      (
        window as typeof window & {
          SpeechRecognition?: new () => SpeechRecognitionLike;
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).SpeechRecognition ??
      (
        window as typeof window & {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not available in this browser.");
      return;
    }
    const instance = new SpeechRecognition();
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = navigator.language || "en-US";
    instance.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setMessage((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    instance.onend = () => setListening(false);
    instance.onerror = () => {
      setListening(false);
      setError("Speech recognition stopped unexpectedly.");
    };
    recognition.current = instance;
    setListening(true);
    instance.start();
  }, [listening]);

  const loadSessions = useCallback(async () => {
    const [sessionResponse, accountResponse, modelsResponse, plansResponse] = await Promise.all([
      apiClient.v1.sessions.$get(),
      apiClient.v1["provider-accounts"].$get(),
      apiClient.v1.models.$get(),
      apiClient.v1.plans.$get(),
    ]);
    if (!sessionResponse.ok || !accountResponse.ok || !modelsResponse.ok) {
      setError("Sessions could not be loaded");
      return;
    }
    const nextSessions = (await sessionResponse.json()) as AgentSession[];
    for (const nextSession of nextSessions) {
      const previous = previousStatuses.current[nextSession.id];
      if ((previous === "running" || previous === "queued") && nextSession.status === "idle") {
        void notifySessionComplete(nextSession.title);
      }
    }
    previousStatuses.current = Object.fromEntries(
      nextSessions.map((nextSession) => [nextSession.id, nextSession.status]),
    );
    setSessions(nextSessions);
    setAccounts((await accountResponse.json()) as ProviderAccount[]);
    const catalog = await modelsResponse.json();
    setModels(catalog.models);
    if (plansResponse.ok) setPlans((await plansResponse.json()) as PlanArtifact[]);
    setActiveId((current) => current ?? nextSessions[0]?.id);
  }, []);

  const loadEvents = useCallback(async (sessionId: string) => {
    const response = await apiClient.v1.sessions[":id"].events.$get({
      param: { id: sessionId },
    });
    if (response.ok) {
      setEvents((await response.json()) as SessionEvent[]);
      window.requestAnimationFrame(() =>
        transcriptEnd.current?.scrollIntoView({ behavior: "smooth" }),
      );
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!activeId) {
      setEvents([]);
      return;
    }
    void loadEvents(activeId);
    const timer = window.setInterval(() => {
      void loadEvents(activeId);
      void loadSessions();
    }, 1800);
    return () => window.clearInterval(timer);
  }, [activeId, loadEvents, loadSessions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("home://push-to-talk", startDictation))
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [startDictation]);

  async function createSession() {
    if (!accounts.length) {
      setError("Add an AI provider API key in Settings first.");
      return undefined;
    }
    const account = accounts[0];
    if (!account) return undefined;
    const response = await apiClient.v1.sessions.$post({
      json: {
        title: "New session",
        providerAccountId: account.id,
        modelOverride: models[account.provider]?.[0],
        enabledToolsets: ["items", "memory"],
      },
    });
    if (!response.ok) {
      setError("A session could not be created");
      return undefined;
    }
    const session = (await response.json()) as AgentSession;
    setSessions((current) => [session, ...current]);
    setActiveId(session.id);
    setEvents([]);
    return session;
  }

  async function updateSession(patch: Partial<AgentSession>) {
    if (!active) return;
    const response = await apiClient.v1.sessions[":id"].$patch({
      param: { id: active.id },
      json: {
        effort: patch.effort,
        enabledToolsets: patch.enabledToolsets,
        mode: patch.mode,
        modelOverride: patch.modelOverride ?? undefined,
        providerAccountId: patch.providerAccountId ?? undefined,
        title: patch.title,
      },
    });
    if (response.ok) {
      const updated = (await response.json()) as AgentSession;
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session)),
      );
    }
  }

  async function sendMessage() {
    if (!message.trim() || pending) return;
    let session = active;
    if (!session) session = await createSession();
    if (!session) return;
    setPending(true);
    setError(undefined);
    const response = await apiClient.v1.sessions[":id"].messages.$post({
      param: { id: session.id },
      json: {
        content: message.trim(),
        attachmentIds: attachments.map((attachment) => attachment.id),
        model: session.modelOverride ?? undefined,
        providerAccountId: session.providerAccountId ?? undefined,
      },
    });
    if (!response.ok) {
      const result = await response.json();
      setError("error" in result ? String(result.error) : "Message could not be queued");
    } else {
      setMessage("");
      setAttachments([]);
      await loadEvents(session.id);
      await loadSessions();
    }
    setPending(false);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    let session = active;
    if (!session) session = await createSession();
    if (!session) return;
    setPending(true);
    for (const file of Array.from(files)) {
      const response = await apiClient.v1.attachments.presign.$post({
        json: {
          sessionId: session.id,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      });
      const result = await response.json();
      if (!response.ok || !("uploadUrl" in result)) {
        setError("error" in result ? String(result.error) : "Attachment upload is unavailable");
        continue;
      }
      const upload = await fetch(result.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!upload.ok) {
        setError(`${file.name} could not be uploaded`);
        continue;
      }
      await apiClient.v1.attachments[":id"].complete.$post({
        param: { id: result.attachmentId },
      });
      setAttachments((current) => [...current, { id: result.attachmentId, fileName: file.name }]);
    }
    setPending(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function forkPlan(plan: PlanArtifact) {
    const response = await apiClient.v1.plans[":id"].fork.$post({
      param: { id: plan.id },
      json: {
        title: `Execute: ${plan.title}`,
        mode: "ask",
        backend: "hosted",
        providerAccountId: accounts[0]?.id,
        modelOverride: accounts[0] ? models[accounts[0].provider]?.[0] : undefined,
      },
    });
    if (response.ok) {
      const result = await response.json();
      await loadSessions();
      setActiveId(result.sessionId);
    }
  }

  const transcript = useMemo(
    () =>
      events.filter(
        (event) =>
          event.type === "message" || event.type === "plan" || event.type.startsWith("tool_"),
      ),
    [events],
  );

  return (
    <div className="mx-auto grid h-[calc(100vh-5rem)] max-w-7xl gap-4 xl:grid-cols-[260px_1fr]">
      <Card className="hidden min-h-0 overflow-hidden xl:flex xl:flex-col">
        <div className="flex items-center justify-between border-b border-white/[0.06] p-3">
          <p className="text-xs font-medium text-zinc-400">Sessions</p>
          <Button className="size-8 p-0" onClick={() => void createSession()} variant="ghost">
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.map((session) => (
            <button
              className={cn(
                "mb-1 w-full rounded-lg px-3 py-2.5 text-left",
                session.id === activeId ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
              )}
              key={session.id}
              onClick={() => setActiveId(session.id)}
              type="button"
            >
              <p className="truncate text-xs font-medium text-zinc-300">{session.title}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-600">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    session.status === "failed"
                      ? "bg-red-400"
                      : session.status === "running" || session.status === "queued"
                        ? "animate-pulse bg-amber-300"
                        : "bg-emerald-400",
                  )}
                />
                {session.status}
              </p>
            </button>
          ))}
          {plans.length ? (
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="px-3 text-[9px] uppercase tracking-wide text-zinc-700">Plans</p>
              {plans.slice(0, 8).map((plan) => (
                <button
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[11px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                  key={plan.id}
                  onClick={() => void forkPlan(plan)}
                  type="button"
                >
                  <GitFork className="size-3.5 shrink-0 text-violet-300" />
                  <span className="truncate">{plan.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <Bot className="size-4 text-emerald-400" />
          <input
            className="min-w-32 flex-1 bg-transparent text-sm font-medium text-zinc-200 outline-none"
            disabled={!active}
            onBlur={(event) => void updateSession({ title: event.target.value })}
            onChange={(event) =>
              active &&
              setSessions((current) =>
                current.map((session) =>
                  session.id === active.id ? { ...session, title: event.target.value } : session,
                ),
              )
            }
            placeholder="New session"
            value={active?.title ?? ""}
          />
          {active ? (
            <>
              <label className="relative">
                <select
                  className="appearance-none rounded-md border border-white/[0.08] bg-zinc-900 py-1.5 pl-2 pr-7 text-[11px] text-zinc-400 outline-none"
                  onChange={(event) =>
                    void updateSession({ mode: event.target.value as AgentSession["mode"] })
                  }
                  value={active.mode}
                >
                  <option value="plan">Plan</option>
                  <option value="ask">Ask</option>
                  <option value="auto">Auto</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-2 size-3 text-zinc-600" />
              </label>
              <label className="relative">
                <select
                  className="appearance-none rounded-md border border-white/[0.08] bg-zinc-900 py-1.5 pl-2 pr-7 text-[11px] text-zinc-400 outline-none"
                  onChange={(event) => void updateSession({ effort: event.target.value })}
                  value={active.effort}
                >
                  <option value="low">Low effort</option>
                  <option value="medium">Medium effort</option>
                  <option value="high">High effort</option>
                </select>
                <Settings2 className="pointer-events-none absolute right-2 top-2 size-3 text-zinc-600" />
              </label>
            </>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {!transcript.length ? (
            <div className="mx-auto grid h-full max-w-xl place-items-center text-center">
              <div>
                <span className="mx-auto grid size-11 place-items-center rounded-xl bg-emerald-400/10 text-emerald-400">
                  <Bot className="size-5" />
                </span>
                <h2 className="mt-4 text-lg font-medium text-zinc-200">What should we work on?</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Search connected work, reason over your inbox, or ask home to remember something.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {transcript.map((event) =>
                event.type.startsWith("tool_") ? (
                  <div
                    className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-zinc-500"
                    key={event.id}
                  >
                    <Wrench className="mt-0.5 size-3.5 shrink-0 text-violet-300" />
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-400">
                        {event.type === "tool_call" ? "Tool call" : "Tool result"}
                      </p>
                      <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap font-mono text-[10px] text-zinc-600">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : event.type === "plan" ? (
                  <div
                    className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4"
                    key={event.id}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium text-violet-300">
                      <GitFork className="size-3.5" /> Plan artifact
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                      {event.content}
                    </p>
                  </div>
                ) : (
                  <div
                    className={cn("flex", event.role === "user" ? "justify-end" : "justify-start")}
                    key={event.id}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-6",
                        event.role === "user"
                          ? "bg-emerald-400 text-zinc-950"
                          : "border border-white/[0.06] bg-white/[0.03] text-zinc-300",
                      )}
                    >
                      {event.content}
                      {event.model && event.role === "assistant" ? (
                        <p className="mt-2 font-mono text-[9px] uppercase tracking-wide text-zinc-600">
                          {event.model}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ),
              )}
              {active?.status === "queued" || active?.status === "running" ? (
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <LoaderCircle className="size-3.5 animate-spin text-emerald-400" /> home is
                  working…
                </div>
              ) : null}
              <div ref={transcriptEnd} />
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] p-3 sm:p-4">
          {error ? <p className="mx-auto mb-2 max-w-3xl text-xs text-red-300">{error}</p> : null}
          {attachments.length ? (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
              {attachments.map((attachment) => (
                <span
                  className="flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1 text-[10px] text-zinc-400"
                  key={attachment.id}
                >
                  {attachment.fileName}
                  <button
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((candidate) => candidate.id !== attachment.id),
                      )
                    }
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-white/[0.09] bg-black/25 p-2 focus-within:border-emerald-400/30">
            <input
              className="hidden"
              multiple
              onChange={(event) => void uploadFiles(event.target.files)}
              ref={fileInput}
              type="file"
            />
            <Button
              className="size-9 shrink-0 p-0"
              disabled={pending}
              onClick={() => fileInput.current?.click()}
              variant="ghost"
            >
              <Paperclip className="size-4" />
            </Button>
            <Button
              className={cn("size-9 shrink-0 p-0", listening && "bg-red-400/10 text-red-300")}
              onClick={startDictation}
              variant="ghost"
            >
              <Mic className={cn("size-4", listening && "animate-pulse")} />
            </Button>
            <textarea
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-700"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Message home…"
              rows={1}
              value={message}
            />
            <label className="relative hidden sm:block">
              <select
                className="max-w-40 appearance-none bg-transparent py-2 pl-2 pr-6 text-[10px] text-zinc-600 outline-none"
                disabled={!active}
                onChange={(event) => void updateSession({ modelOverride: event.target.value })}
                value={active?.modelOverride ?? ""}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-3 size-3 text-zinc-700" />
            </label>
            <Button
              className="size-9 shrink-0 p-0"
              disabled={!message.trim() || pending || active?.status === "running"}
              onClick={() => void sendMessage()}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
