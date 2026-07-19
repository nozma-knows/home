export const JOBS = {
  executeItemAction: "items.execute-action",
  runSession: "sessions.run",
  distillSession: "memory.distill-session",
  generateBriefing: "briefings.generate",
  generateScheduledBriefings: "briefings.generate-scheduled",
  syncFeed: "feeds.sync",
  syncFeeds: "feeds.sync-all",
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

export type RunSessionJob = {
  runId: string;
  sessionId: string;
  userId: string;
};

export type DistillSessionJob = {
  sessionId: string;
  userId: string;
};

export type GenerateBriefingJob = {
  userId: string;
  force?: boolean;
};

export type SyncFeedJob = {
  feedId: string;
  userId: string;
};
