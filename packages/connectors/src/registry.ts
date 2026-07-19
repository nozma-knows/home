import { gmailConnector } from "./gmail";
import { linearConnector } from "./linear";
import { slackConnector } from "./slack";
import type { Connector, ConnectorId } from "./types";

const connectors = {
  gmail: gmailConnector,
  linear: linearConnector,
  slack: slackConnector,
} satisfies Record<ConnectorId, Connector>;

export function isConnectorId(value: string): value is ConnectorId {
  return value in connectors;
}

export function getConnector(id: ConnectorId) {
  return connectors[id];
}

export function listConnectors() {
  return Object.values(connectors).map(({ displayName, id }) => ({ displayName, id }));
}

export function getConnectorCredentials(id: ConnectorId) {
  const prefix = id.toUpperCase();
  const clientId =
    process.env[`${prefix}_CLIENT_ID`] ??
    (id === "gmail" ? process.env.GOOGLE_CLIENT_ID : undefined);
  const clientSecret =
    process.env[`${prefix}_CLIENT_SECRET`] ??
    (id === "gmail" ? process.env.GOOGLE_CLIENT_SECRET : undefined);

  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}
