import type { OAuthTokens } from "./types";

type TokenRequest = {
  body: URLSearchParams;
  endpoint: string;
  headers?: HeadersInit;
};

export async function requestOAuthTokens({ body, endpoint, headers }: TokenRequest) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok || typeof payload.access_token !== "string") {
    const message =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `OAuth token exchange failed with ${response.status}`;
    throw new Error(message);
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
  const scopes =
    typeof payload.scope === "string" ? payload.scope.split(/[ ,]/).filter(Boolean) : [];

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scopes,
  } satisfies OAuthTokens;
}

export async function fetchJson<T>(url: string | URL, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  const payload = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(`Connector request failed with ${response.status}`);
  }
  return payload;
}
