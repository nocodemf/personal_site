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

// Consolidate similar notes at 2am daily
// Runs after daily notes are processed, finds and merges duplicate/similar notes
// This keeps the knowledge base clean and reduces noise
crons.daily(
  "consolidate notes",
  { hourUTC: 2, minuteUTC: 0 },
  internal.cronHandlers.consolidateNotesCron
);

// Generate AI summary of today's activity every 30 minutes
// Reads the today note + tasks and creates a one-sentence overview
crons.interval(
  "generate today summary",
  { minutes: 30 },
  internal.dailyNotes.generateTodaySummary
);

export default crons;

