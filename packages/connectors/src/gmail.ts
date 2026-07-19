import { fetchJson, requestOAuthTokens } from "./oauth";
import type { Connector, NormalizedItem } from "./types";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function normalizeMessage(message: GmailMessage): NormalizedItem | undefined {
  if (!message.id) return undefined;
  const from = header(message, "from") ?? "Unknown sender";
  const to = header(message, "to") ?? "";
  const subject = header(message, "subject") ?? "(No subject)";

  return {
    externalId: message.id,
    threadId: message.threadId,
    type: "email_thread",
    title: subject,
    body: message.snippet,
    preview: message.snippet,
    participants: [from, to].filter(Boolean),
    externalUrl: message.threadId
      ? `https://mail.google.com/mail/u/0/#inbox/${message.threadId}`
      : undefined,
    isRead: !message.labelIds?.includes("UNREAD"),
    isDirectMention: false,
    isAssigned: false,
    occurredAt: new Date(Number(message.internalDate ?? Date.now())),
    raw: message as Record<string, unknown>,
  };
}

function encodeMessage(input: Record<string, unknown>) {
  const to = String(input.to ?? "");
  const subject = String(input.subject ?? "Re: home triage");
  const body = String(input.body ?? "");
  if (!to || !body) throw new Error("Gmail replies require to and body");

  return Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
      "\r\n",
    ),
  ).toString("base64url");
}

export const gmailConnector: Connector = {
  id: "gmail",
  displayName: "Gmail",
  createAuthorizationURL({ clientId, codeChallenge, redirectURI, state }) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      access_type: "offline",
      client_id: clientId,
      include_granted_scopes: "true",
      prompt: "consent",
      redirect_uri: redirectURI,
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      state,
      ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    }).toString();
    return url;
  },
  exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectURI }) {
    return requestOAuthTokens({
      endpoint: "https://oauth2.googleapis.com/token",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectURI,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });
  },
  async getIdentity(accessToken) {
    const profile = await fetchJson<{ email: string; id: string; name?: string }>(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      accessToken,
    );
    return {
      externalAccountId: profile.id,
      label: profile.email,
      metadata: { email: profile.email, name: profile.name },
    };
  },
  async sync({ accessToken, cursor }) {
    const after =
      typeof cursor.historyId === "string" ? `after:${cursor.historyId}` : "newer_than:30d";
    const listURL = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listURL.search = new URLSearchParams({ maxResults: "30", q: after }).toString();
    const list = await fetchJson<{ messages?: Array<{ id: string }>; resultSizeEstimate?: number }>(
      listURL,
      accessToken,
    );
    const messages = await Promise.all(
      (list.messages ?? []).map(({ id }) =>
        fetchJson<GmailMessage>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
          accessToken,
        ),
      ),
    );
    const items = messages.map(normalizeMessage).filter((item) => item !== undefined);
    const newest = messages.reduce(
      (maximum, message) => Math.max(maximum, Number(message.internalDate ?? 0)),
      Number(cursor.historyId ?? 0),
    );
    return { items, cursor: { historyId: String(newest) } };
  },
  async executeAction(action, input, { accessToken }) {
    const messageId = String(input.messageId ?? input.externalId ?? "");
    if (action === "archive" || action === "mark-read") {
      if (!messageId) throw new Error(`${action} requires a Gmail message ID`);
      const removeLabelIds = action === "archive" ? ["INBOX"] : ["UNREAD"];
      return fetchJson<Record<string, unknown>>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds }),
        },
      );
    }
    if (action === "reply") {
      return fetchJson<Record<string, unknown>>(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: encodeMessage(input), threadId: input.threadId }),
        },
      );
    }
    throw new Error(`Unsupported Gmail action: ${action}`);
  },
};
