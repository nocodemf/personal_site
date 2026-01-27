import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Save daily notes to index at 11:45pm every day
// Note: Convex crons use UTC
// 23:45 UTC = 23:45 GMT (winter) or 00:45 BST (summer)
// For UK, we want ~11:45pm local time year-round
// Using 23:45 UTC for winter, which means 00:45 next day in summer
// This is acceptable - notes will still save, just technically after midnight in summer
crons.daily(
  "save daily notes",
  { hourUTC: 23, minuteUTC: 45 },
  internal.cronHandlers.processDailyNotesCron
);

export default crons;

