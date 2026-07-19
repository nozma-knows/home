"use client";

import { Button, Card } from "@home/ui";
import { Braces, Plus, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type McpServer = {
  id: string;
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
};
type Plugin = {
  id: string;
  name: string;
  slashCommand: string;
  description: string | null;
  instructions: string;
};

export function ExtensionsSettings() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [serverName, setServerName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [slashCommand, setSlashCommand] = useState("");
  const [instructions, setInstructions] = useState("");

  const load = useCallback(async () => {
    const [serverResponse, pluginResponse] = await Promise.all([
      apiClient.v1["mcp-servers"].$get(),
      apiClient.v1.plugins.$get(),
    ]);
    if (serverResponse.ok) setServers((await serverResponse.json()) as McpServer[]);
    if (pluginResponse.ok) setPlugins((await pluginResponse.json()) as Plugin[]);
  }, []);

  useEffect(() => void load(), [load]);

  async function addServer() {
    if (!serverName.trim() || !serverUrl.trim()) return;
    const response = await apiClient.v1["mcp-servers"].$post({
      json: { name: serverName, transport: "remote_http", url: serverUrl, enabled: true },
    });
    if (response.ok) {
      setServerName("");
      setServerUrl("");
      await load();
    }
  }

  async function addPlugin() {
    if (!pluginName.trim() || !slashCommand.trim() || !instructions.trim()) return;
    const response = await apiClient.v1.plugins.$post({
      json: { name: pluginName, slashCommand, instructions, enabled: true },
    });
    if (response.ok) {
      setPluginName("");
      setSlashCommand("");
      setInstructions("");
      await load();
    }
  }

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <Braces className="size-4 text-zinc-500" />
        <h2 className="text-sm font-medium text-zinc-200">Extensions</h2>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-sky-300" />
            <p className="text-xs font-medium text-zinc-300">MCP servers</p>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[0.7fr_1.3fr_auto]">
            <input
              className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none"
              onChange={(event) => setServerName(event.target.value)}
              placeholder="Name"
              value={serverName}
            />
            <input
              className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none"
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://server.example/mcp"
              value={serverUrl}
            />
            <Button className="size-9 p-0" onClick={() => void addServer()}>
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="mt-4 divide-y divide-white/[0.06]">
            {servers.map((server) => (
              <div className="flex items-center gap-2 py-3" key={server.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-300">{server.name}</p>
                  <p className="mt-1 truncate text-[10px] text-zinc-700">
                    {server.url ?? server.command}
                  </p>
                </div>
                <Button
                  className="size-8 p-0"
                  onClick={async () => {
                    await apiClient.v1["mcp-servers"][":id"].$delete({ param: { id: server.id } });
                    await load();
                  }}
                  variant="ghost"
                >
                  <Trash2 className="size-3.5 text-red-300" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-zinc-300">Skills & slash commands</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none"
              onChange={(event) => setPluginName(event.target.value)}
              placeholder="Skill name"
              value={pluginName}
            />
            <input
              className="rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 font-mono text-xs outline-none"
              onChange={(event) => setSlashCommand(event.target.value)}
              placeholder="/command"
              value={slashCommand}
            />
            <textarea
              className="col-span-2 min-h-20 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs outline-none"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Markdown instructions used when the command starts a message"
              value={instructions}
            />
            <Button
              className="col-span-2 gap-2"
              onClick={() => void addPlugin()}
              variant="secondary"
            >
              <Plus className="size-3.5" /> Add skill
            </Button>
          </div>
          <div className="mt-4 divide-y divide-white/[0.06]">
            {plugins.map((plugin) => (
              <div className="flex items-center gap-2 py-3" key={plugin.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-300">
                    /{plugin.slashCommand} · {plugin.name}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-zinc-700">
                    {plugin.description ?? plugin.instructions}
                  </p>
                </div>
                <Button
                  className="size-8 p-0"
                  onClick={async () => {
                    await apiClient.v1.plugins[":id"].$delete({ param: { id: plugin.id } });
                    await load();
                  }}
                  variant="ghost"
                >
                  <Trash2 className="size-3.5 text-red-300" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
