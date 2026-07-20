import { fetchJson, requestOAuthTokens } from "./oauth";
import type { Connector, NormalizedItem } from "./types";

const LINEAR_SCOPES = ["read", "write", "issues:create", "comments:create"];

type LinearGraphQLResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

async function linearGraphQL<T>(accessToken: string, query: string, variables?: object) {
  const result = await fetchJson<LinearGraphQLResponse<T>>(
    "https://api.linear.app/graphql",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (result.errors?.length) throw new Error(result.errors[0]?.message ?? "Linear request failed");
  if (!result.data) throw new Error("Linear returned no data");
  return result.data;
}

type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  updatedAt: string;
  assignee?: { id: string; name?: string };
  creator?: { name?: string };
  state?: { name?: string; type?: string };
};

function normalizeIssue(issue: LinearIssue, viewerId?: string): NormalizedItem {
  return {
    externalId: issue.id,
    threadId: issue.id,
    type: "linear_issue",
    title: `${issue.identifier} · ${issue.title}`,
    body: issue.description,
    preview: issue.description?.slice(0, 240),
    participants: [issue.assignee?.name, issue.creator?.name].filter(
      (participant): participant is string => Boolean(participant),
    ),
    externalUrl: issue.url,
    isRead: false,
    isDirectMention: false,
    isAssigned: issue.assignee?.id === viewerId,
    occurredAt: new Date(issue.updatedAt),
    raw: issue as unknown as Record<string, unknown>,
  };
}

export const linearConnector: Connector = {
  id: "linear",
  displayName: "Linear",
  createAuthorizationURL({ clientId, codeChallenge, redirectURI, state }) {
    const url = new URL("https://linear.app/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectURI,
      response_type: "code",
      scope: LINEAR_SCOPES.join(","),
      state,
      ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    }).toString();
    return url;
  },
  exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectURI }) {
    return requestOAuthTokens({
      endpoint: "https://api.linear.app/oauth/token",
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
  refreshAccessToken({ clientId, clientSecret, refreshToken }) {
    return requestOAuthTokens({
      endpoint: "https://api.linear.app/oauth/token",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  },
  async getIdentity(accessToken) {
    const data = await linearGraphQL<{ viewer: { id: string; email: string; name: string } }>(
      accessToken,
      "query Viewer { viewer { id email name } }",
    );
    return {
      externalAccountId: data.viewer.id,
      label: data.viewer.email,
      metadata: { name: data.viewer.name, viewerId: data.viewer.id },
    };
  },
  async sync({ accessToken, cursor, metadata }) {
    const data = await linearGraphQL<{
      issues: { nodes: LinearIssue[] };
    }>(
      accessToken,
      `query TriageIssues($after: DateTimeOrDuration) {
        issues(first: 50, filter: { updatedAt: { gte: $after } }, orderBy: updatedAt) {
          nodes { id identifier title description url updatedAt assignee { id name } creator { name } state { name type } }
        }
      }`,
      { after: cursor.updatedAt ?? "P30D" },
    );
    const items = data.issues.nodes.map((issue) =>
      normalizeIssue(issue, String(metadata.viewerId ?? "")),
    );
    const updatedAt = items.reduce(
      (latest, item) => (item.occurredAt > latest ? item.occurredAt : latest),
      new Date(String(cursor.updatedAt ?? 0)),
    );
    return { items, cursor: { updatedAt: updatedAt.toISOString() } };
  },
  async executeAction(action, input, { accessToken }) {
    if (action === "reply" || action === "comment") {
      const issueId = String(input.issueId ?? input.externalId ?? "");
      const body = String(input.body ?? "");
      if (!issueId || !body) throw new Error("Linear comments require issueId and body");
      return linearGraphQL<Record<string, unknown>>(
        accessToken,
        "mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }",
        { input: { issueId, body } },
      );
    }
    throw new Error(`Unsupported Linear action: ${action}`);
  },
};
