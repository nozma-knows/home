import { fetchJson, requestOAuthTokens } from "./oauth";
import type { Connector, NormalizedItem } from "./types";

const SLACK_SCOPES = [
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "im:history",
  "mpim:history",
  "users:read",
];

type SlackResponse = { ok: boolean; error?: string };

async function slackRequest<T extends SlackResponse>(
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
) {
  const payload = await fetchJson<T>(`https://slack.com/api/${method}`, accessToken, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!payload.ok) throw new Error(payload.error ?? `Slack ${method} failed`);
  return payload;
}

function normalizeSlackMessage(
  message: Record<string, unknown>,
  channel: { id: string; name?: string },
  userId?: string,
): NormalizedItem | undefined {
  const timestamp = typeof message.ts === "string" ? message.ts : undefined;
  if (!timestamp) return undefined;
  const text = typeof message.text === "string" ? message.text : "";
  const sender = typeof message.user === "string" ? message.user : "Slack";

  return {
    externalId: `${channel.id}:${timestamp}`,
    threadId: typeof message.thread_ts === "string" ? message.thread_ts : timestamp,
    type: "slack_message",
    title: channel.name ? `#${channel.name}` : "Slack message",
    body: text,
    preview: text.slice(0, 240),
    participants: [sender],
    externalUrl: undefined,
    isRead: true,
    isDirectMention: Boolean(userId && text.includes(`<@${userId}>`)),
    isAssigned: false,
    occurredAt: new Date(Number(timestamp) * 1000),
    raw: { ...message, channelId: channel.id, channelName: channel.name },
  };
}

export const slackConnector: Connector = {
  id: "slack",
  displayName: "Slack",
  createAuthorizationURL({ clientId, redirectURI, state }) {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectURI,
      scope: SLACK_SCOPES.join(","),
      state,
    }).toString();
    return url;
  },
  exchangeCode({ clientId, clientSecret, code, redirectURI }) {
    return requestOAuthTokens({
      endpoint: "https://slack.com/api/oauth.v2.access",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectURI,
      }),
    });
  },
  async getIdentity(accessToken) {
    const identity = await slackRequest<
      SlackResponse & { team?: string; team_id?: string; user?: string; user_id?: string }
    >("auth.test", accessToken);
    return {
      externalAccountId: identity.team_id ?? identity.user_id ?? "slack",
      label: [identity.team, identity.user].filter(Boolean).join(" · ") || "Slack workspace",
      metadata: { teamId: identity.team_id, team: identity.team, userId: identity.user_id },
    };
  },
  async sync({ accessToken, cursor, metadata }) {
    const channels = await slackRequest<
      SlackResponse & { channels?: Array<{ id: string; name?: string }> }
    >("conversations.list?types=public_channel,private_channel,im,mpim&limit=20", accessToken);
    const items: NormalizedItem[] = [];

    for (const channel of (channels.channels ?? []).slice(0, 10)) {
      const oldest = typeof cursor.latest === "string" ? `&oldest=${cursor.latest}` : "";
      const history = await slackRequest<
        SlackResponse & { messages?: Array<Record<string, unknown>> }
      >(`conversations.history?channel=${channel.id}&limit=20${oldest}`, accessToken);
      for (const message of history.messages ?? []) {
        const item = normalizeSlackMessage(message, channel, String(metadata.userId ?? ""));
        if (item) items.push(item);
      }
    }

    const latest = items.reduce(
      (value, item) => Math.max(value, item.occurredAt.getTime() / 1000),
      Number(cursor.latest ?? 0),
    );
    return { items, cursor: { latest: String(latest) } };
  },
  async executeAction(action, input, { accessToken }) {
    if (action === "reply" || action === "post") {
      const channel = String(input.channel ?? input.channelId ?? "");
      const text = String(input.body ?? input.text ?? "");
      if (!channel || !text) throw new Error("Slack messages require channel and text");
      return slackRequest<SlackResponse & Record<string, unknown>>(
        "chat.postMessage",
        accessToken,
        {
          channel,
          text,
          ...(input.threadId ? { thread_ts: input.threadId } : {}),
        },
      );
    }
    throw new Error(`Unsupported Slack action: ${action}`);
  },
};
