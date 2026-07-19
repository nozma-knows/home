"use client";

import { Button, Card, cn } from "@home/ui";
import { Check, Link2, LoaderCircle, RefreshCw, Settings, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Connector = {
  id: "gmail" | "slack" | "linear";
  displayName: string;
  available: boolean;
};

type Connection = {
  id: string;
  provider: Connector["id"];
  label: string;
  status: "active" | "needs_reattention" | "disconnected";
  lastSyncedAt: string | null;
  lastError: string | null;
};

const connectorDescriptions = {
  gmail: "Email threads, replies, archive, and read state.",
  slack: "Mentions and messages across your workspace.",
  linear: "Assigned issues, project updates, and comments.",
};

export function SettingsView() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [connectorResponse, connectionResponse] = await Promise.all([
      apiClient.v1.connectors.$get(),
      apiClient.v1.connections.$get(),
    ]);
    if (!connectorResponse.ok || !connectionResponse.ok) {
      setError("Connection settings could not be loaded");
      return;
    }
    setConnectors((await connectorResponse.json()) as Connector[]);
    setConnections((await connectionResponse.json()) as Connection[]);
    setError(undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(provider: Connector["id"]) {
    setPending(provider);
    const response = await apiClient.v1.connections[":provider"].authorize.$post({
      param: { provider },
      json: { returnTo: "/?view=settings" },
    });
    const result = await response.json();
    if (!response.ok || !("url" in result)) {
      setError("error" in result ? String(result.error) : `Could not connect ${provider}`);
      setPending(undefined);
      return;
    }
    window.location.assign(result.url);
  }

  async function sync(connection: Connection) {
    setPending(connection.id);
    const response = await apiClient.v1.connections[":id"].sync.$post({
      param: { id: connection.id },
    });
    if (!response.ok) setError(`Could not sync ${connection.label}`);
    setPending(undefined);
    window.setTimeout(() => void load(), 1200);
  }

  async function disconnect(connection: Connection) {
    if (!window.confirm(`Disconnect ${connection.label}? Imported items from it will be removed.`))
      return;
    setPending(connection.id);
    const response = await apiClient.v1.connections[":id"].$delete({
      param: { id: connection.id },
    });
    if (!response.ok) setError(`Could not disconnect ${connection.label}`);
    setPending(undefined);
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-600">Workspace</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Connect the tools that feed your command center.
        </p>
      </header>

      {error ? (
        <p className="mt-5 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <section className="mt-9">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-200">Connections</h2>
        </div>
        <div className="mt-4 grid gap-3">
          {connectors.map((connector) => {
            const matches = connections.filter(
              (connection) => connection.provider === connector.id,
            );
            return (
              <Card className="p-5" key={connector.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-zinc-100">{connector.displayName}</h3>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          connector.available
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "bg-amber-400/10 text-amber-300",
                        )}
                      >
                        {connector.available ? "Ready" : "Needs OAuth keys"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-600">
                      {connectorDescriptions[connector.id]}
                    </p>
                  </div>
                  <Button
                    className="gap-2"
                    disabled={!connector.available || pending !== undefined}
                    onClick={() => void connect(connector.id)}
                    variant="secondary"
                  >
                    {pending === connector.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Link2 className="size-3.5" />
                    )}
                    Connect {connector.displayName}
                  </Button>
                </div>

                {matches.length ? (
                  <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
                    {matches.map((connection) => (
                      <div className="flex flex-wrap items-center gap-3 py-3" key={connection.id}>
                        <span
                          className={cn(
                            "grid size-7 place-items-center rounded-full",
                            connection.status === "active"
                              ? "bg-emerald-400/10 text-emerald-400"
                              : "bg-red-400/10 text-red-300",
                          )}
                        >
                          <Check className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-zinc-300">
                            {connection.label}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-600">
                            {connection.lastError
                              ? connection.lastError
                              : connection.lastSyncedAt
                                ? `Synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
                                : "Initial sync queued"}
                          </p>
                        </div>
                        <Button
                          className="gap-1.5"
                          disabled={pending !== undefined}
                          onClick={() => void sync(connection)}
                          variant="ghost"
                        >
                          <RefreshCw
                            className={cn("size-3.5", pending === connection.id && "animate-spin")}
                          />
                          Sync
                        </Button>
                        <Button
                          className="gap-1.5 text-red-300"
                          disabled={pending !== undefined}
                          onClick={() => void disconnect(connection)}
                          variant="ghost"
                        >
                          <Unplug className="size-3.5" /> Disconnect
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
