import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Save daily notes to index at 11:45pm every day (UK time)
// Convex crons use UTC, so 23:45 UK = 23:45 UTC (or 22:45 UTC during BST)
// Using 23:45 UTC which is close enough for most purposes
crons.daily(
  "save daily notes",
  { hourUTC: 23, minuteUTC: 45 },
  internal.cronHandlers.processDailyNotesCron
);

export default crons;

