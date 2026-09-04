import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Quota history is append-only on sync; this keeps the table to the retention window.
crons.daily(
  "prune quota snapshots",
  { hourUTC: 4, minuteUTC: 15 },
  internal.quota.pruneSnapshots,
  {},
);

export default crons;
