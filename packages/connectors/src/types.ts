export type ConnectorId = "gmail" | "slack" | "linear";

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
};

export type ConnectorIdentity = {
  externalAccountId: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export type NormalizedItem = {
  externalId: string;
  threadId?: string;
  type: string;
  title: string;
  body?: string;
  preview?: string;
  participants: string[];
  externalUrl?: string;
  isRead: boolean;
  isDirectMention: boolean;
  isAssigned: boolean;
  occurredAt: Date;
  raw: Record<string, unknown>;
};

export type SyncResult = {
  cursor: Record<string, unknown>;
  items: NormalizedItem[];
};

export type ConnectorContext = {
  accessToken: string;
  cursor: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export interface Connector {
  id: ConnectorId;
  displayName: string;
  createAuthorizationURL(input: {
    clientId: string;
    codeChallenge?: string;
    redirectURI: string;
    state: string;
  }): URL;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier?: string;
    redirectURI: string;
  }): Promise<OAuthTokens>;
  refreshAccessToken?(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<OAuthTokens>;
  getIdentity(accessToken: string): Promise<ConnectorIdentity>;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
  executeAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ConnectorContext,
  ): Promise<Record<string, unknown>>;
}
