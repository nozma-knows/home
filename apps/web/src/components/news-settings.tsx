"use client";

import { Button, Card } from "@home/ui";
import { LoaderCircle, Newspaper, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

type Feed = {
  id: string;
  title: string;
  url: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};
type Topic = { id: string; topic: string };

export function NewsSettings() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [feedUrl, setFeedUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [pending, setPending] = useState<string>();

  const load = useCallback(async () => {
    const [feedsResponse, topicsResponse] = await Promise.all([
      apiClient.v1["rss-feeds"].$get(),
      apiClient.v1["news-topics"].$get(),
    ]);
    if (feedsResponse.ok) setFeeds((await feedsResponse.json()) as Feed[]);
    if (topicsResponse.ok) setTopics((await topicsResponse.json()) as Topic[]);
  }, []);

  useEffect(() => void load(), [load]);

  async function addFeed() {
    if (!feedUrl.trim()) return;
    setPending("feed");
    const response = await apiClient.v1["rss-feeds"].$post({ json: { url: feedUrl } });
    if (response.ok) {
      setFeedUrl("");
      await load();
    }
    setPending(undefined);
  }

  async function addTopic() {
    if (!topic.trim()) return;
    setPending("topic");
    const response = await apiClient.v1["news-topics"].$post({ json: { topic } });
    if (response.ok) {
      setTopic("");
      await load();
    }
    setPending(undefined);
  }

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <Newspaper className="size-4 text-zinc-500" />
        <h2 className="text-sm font-medium text-zinc-200">Briefing sources</h2>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium text-zinc-300">RSS feeds</p>
          <div className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-zinc-300 outline-none"
              onChange={(event) => setFeedUrl(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void addFeed()}
              placeholder="https://example.com/feed.xml"
              value={feedUrl}
            />
            <Button
              className="size-9 p-0"
              disabled={pending !== undefined}
              onClick={() => void addFeed()}
            >
              {pending === "feed" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
            </Button>
          </div>
          <div className="mt-4 divide-y divide-white/[0.06]">
            {feeds.map((feed) => (
              <div className="flex items-center gap-2 py-3" key={feed.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-zinc-300">{feed.title}</p>
                  <p className="mt-1 truncate text-[10px] text-zinc-700">
                    {feed.lastError ||
                      (feed.lastSyncedAt
                        ? `Synced ${new Date(feed.lastSyncedAt).toLocaleString()}`
                        : feed.url)}
                  </p>
                </div>
                <Button
                  className="size-8 p-0"
                  onClick={() =>
                    void apiClient.v1["rss-feeds"][":id"].sync.$post({ param: { id: feed.id } })
                  }
                  variant="ghost"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button
                  className="size-8 p-0"
                  onClick={async () => {
                    await apiClient.v1["rss-feeds"][":id"].$delete({ param: { id: feed.id } });
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
          <p className="text-xs font-medium text-zinc-300">News topics</p>
          <div className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-zinc-300 outline-none"
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void addTopic()}
              placeholder="AI tooling, startups, climate…"
              value={topic}
            />
            <Button
              className="size-9 p-0"
              disabled={pending !== undefined}
              onClick={() => void addTopic()}
            >
              {pending === "topic" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {topics.map((item) => (
              <span
                className="flex items-center gap-1 rounded-full bg-sky-400/10 px-3 py-1.5 text-[11px] text-sky-200"
                key={item.id}
              >
                {item.topic}
                <button
                  onClick={async () => {
                    await apiClient.v1["news-topics"][":id"].$delete({ param: { id: item.id } });
                    await load();
                  }}
                  type="button"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-4 text-[10px] leading-5 text-zinc-700">
            Topic search activates when a Tavily key is configured; RSS works without any key.
          </p>
        </Card>
      </div>
    </section>
  );
}
