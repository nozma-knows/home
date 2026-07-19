import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";

export type FeedEntry = {
  externalId: string;
  title: string;
  body?: string;
  preview?: string;
  externalUrl?: string;
  occurredAt: Date;
  raw: Record<string, unknown>;
};

export type ParsedFeed = {
  title?: string;
  entries: FeedEntry[];
};

function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return text(object["#text"] ?? object.__cdata);
  }
  return undefined;
}

function stripMarkup(value?: string) {
  return value
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function atomLink(value: unknown) {
  for (const candidate of array(value)) {
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const link = candidate as Record<string, unknown>;
      if (!link["@_rel"] || link["@_rel"] === "alternate") return text(link["@_href"]);
    }
  }
  return undefined;
}

function entryId(value: string | undefined, link: string | undefined, title: string) {
  return value || link || createHash("sha256").update(title).digest("hex");
}

export function parseFeed(xml: string): ParsedFeed {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as Record<string, unknown>;
  const rss = parsed.rss as { channel?: Record<string, unknown> } | undefined;
  const channel = rss?.channel;
  if (channel) {
    return {
      title: text(channel.title),
      entries: array(channel.item as Record<string, unknown> | Record<string, unknown>[]).map(
        (item) => {
          const title = text(item.title) ?? "Untitled article";
          const link = text(item.link);
          const body = stripMarkup(text(item["content:encoded"] ?? item.description));
          return {
            externalId: entryId(text(item.guid), link, title),
            title,
            body,
            preview: body?.slice(0, 280),
            externalUrl: link,
            occurredAt: new Date(text(item.pubDate ?? item.date) ?? Date.now()),
            raw: item,
          };
        },
      ),
    };
  }

  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (!feed) throw new Error("URL did not return a valid RSS or Atom feed");
  return {
    title: text(feed.title),
    entries: array(feed.entry as Record<string, unknown> | Record<string, unknown>[]).map(
      (item) => {
        const title = text(item.title) ?? "Untitled article";
        const link = atomLink(item.link);
        const body = stripMarkup(text(item.content ?? item.summary));
        return {
          externalId: entryId(text(item.id), link, title),
          title,
          body,
          preview: body?.slice(0, 280),
          externalUrl: link,
          occurredAt: new Date(text(item.updated ?? item.published) ?? Date.now()),
          raw: item,
        };
      },
    ),
  };
}

export async function fetchFeed(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  return parseFeed(await response.text());
}
