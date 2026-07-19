export const JOBS = {
  executeItemAction: "items.execute-action",
  syncConnection: "connections.sync",
  syncConnections: "connections.sync-all",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type SyncConnectionJob = {
  connectionId: string;
  userId: string;
};

export type ExecuteItemActionJob = {
  requestId: string;
  userId: string;
};
