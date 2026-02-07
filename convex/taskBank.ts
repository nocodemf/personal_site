import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Get today's date string in YYYY-MM-DD format
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

// =============================================
// QUERIES
// =============================================

// Get tasks scheduled for today
export const getTodayTasks = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    const tasks = await ctx.db
      .query("taskBank")
      .withIndex("by_status_and_date", (q) =>
        q.eq("status", "active").eq("scheduledDate", today)
      )
      .collect();

    // Sort by creation date (oldest first)
    return tasks.sort((a, b) => a.createdAt - b.createdAt);
  },
});

// Get backlog tasks (active tasks NOT scheduled for today)
// These are tasks from past days that were never completed, or tasks
// that were never scheduled to a specific day.
export const getBacklog = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();

    // Get all active tasks
    const allActive = await ctx.db
      .query("taskBank")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    // Filter out tasks that are scheduled for today (those are on today's list)
    const backlog = allActive.filter(
      (t) => t.scheduledDate !== today
    );

    // Sort: most recently created first
    return backlog.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// =============================================
// MUTATIONS
// =============================================

// Add a new task (defaults to scheduled for today)
export const addTask = mutation({
  args: {
    text: v.string(),
    scheduleForToday: v.optional(v.boolean()), // defaults to true
  },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    const scheduleForToday = args.scheduleForToday !== false;

    return await ctx.db.insert("taskBank", {
      text: args.text,
      status: "active",
      scheduledDate: scheduleForToday ? today : undefined,
      createdAt: Date.now(),
    });
  },
});

// Complete a task
export const completeTask = mutation({
  args: { taskId: v.id("taskBank") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "completed",
      completedAt: Date.now(),
    });
  },
});

// Uncomplete a task (undo completion)
export const uncompleteTask = mutation({
  args: { taskId: v.id("taskBank") },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    await ctx.db.patch(args.taskId, {
      status: "active",
      completedAt: undefined,
      scheduledDate: today,
    });
  },
});

// Schedule a backlog task for today (pull from backlog → today's list)
export const scheduleForToday = mutation({
  args: { taskId: v.id("taskBank") },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    await ctx.db.patch(args.taskId, {
      scheduledDate: today,
    });
  },
});

// Unschedule a task (remove from today → goes back to backlog)
export const unscheduleFromToday = mutation({
  args: { taskId: v.id("taskBank") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      scheduledDate: undefined,
    });
  },
});

// Dismiss a task permanently from backlog
export const dismissTask = mutation({
  args: { taskId: v.id("taskBank") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "dismissed",
    });
  },
});

// Migrate existing dailyNotes tasks into taskBank (one-time migration)
export const migrateFromDailyNotes = mutation({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();

    // Get today's daily note
    const todayNote = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();

    if (!todayNote || todayNote.tasks.length === 0) {
      return { migrated: 0 };
    }

    // Check if we already have tasks for today (avoid double-migration)
    const existingTodayTasks = await ctx.db
      .query("taskBank")
      .withIndex("by_status_and_date", (q) =>
        q.eq("status", "active").eq("scheduledDate", today)
      )
      .collect();

    if (existingTodayTasks.length > 0) {
      return { migrated: 0, reason: "Tasks already exist for today" };
    }

    let migrated = 0;
    for (const task of todayNote.tasks) {
      await ctx.db.insert("taskBank", {
        text: task.text,
        status: task.completed ? "completed" : "active",
        scheduledDate: today,
        createdAt: Date.now(),
        completedAt: task.completed ? Date.now() : undefined,
      });
      migrated++;
    }

    return { migrated };
  },
});

