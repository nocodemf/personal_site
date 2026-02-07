import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// Process all unsaved daily notes - runs at 11:45pm daily
export const processDailyNotesCron = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get all daily notes that haven't been saved yet
    const allDailyNotes = await ctx.runQuery(internal.cronHandlers.getAllDailyNotes, {});
    
    const today = new Date().toISOString().split('T')[0];
    let savedCount = 0;
    const savedNoteIds: string[] = [];

    // ============================================
    // TASK BANK: Snapshot today's tasks from taskBank into dailyNotes
    // before saving, so the index note has accurate task data
    // ============================================
    try {
      await ctx.runMutation(internal.cronHandlers.snapshotTasksForDate, { date: today });
      console.log(`Snapshotted taskBank tasks into dailyNotes for ${today}`);
    } catch (error) {
      console.error(`Failed to snapshot tasks:`, error);
    }

    // ============================================
    // TASK BANK: Unschedule all tasks still active for today
    // They'll appear in backlog tomorrow automatically
    // ============================================
    try {
      await ctx.runMutation(internal.cronHandlers.unscheduleCompletedAndCarryOver, { date: today });
      console.log(`Processed taskBank end-of-day for ${today}`);
    } catch (error) {
      console.error(`Failed to process taskBank end-of-day:`, error);
    }
    
    for (const dailyNote of allDailyNotes) {
      // Skip today's notes and already saved notes
      if (dailyNote.date === today || dailyNote.savedToIndex) continue;
      
      // Skip empty notes
      if (!dailyNote.notes.trim() && dailyNote.tasks.length === 0) continue;
      
      try {
        const result = await ctx.runMutation(internal.dailyNotes.saveDailyToIndex, {
          dailyNoteId: dailyNote._id,
        });
        
        if (result.saved && result.noteId) {
          savedCount++;
          savedNoteIds.push(result.noteId);
          console.log(`Saved daily note for ${dailyNote.date}: ${result.title}`);
        }
      } catch (error) {
        console.error(`Failed to save daily note for ${dailyNote.date}:`, error);
      }
    }
    
    // Also save today's note at 11:45pm
    // Re-fetch since we just updated it with the task snapshot
    const refreshedDailyNotes = await ctx.runQuery(internal.cronHandlers.getAllDailyNotes, {});
    const todayNote = refreshedDailyNotes.find(n => n.date === today);
    if (todayNote && !todayNote.savedToIndex && (todayNote.notes.trim() || todayNote.tasks.length > 0)) {
      try {
        const result = await ctx.runMutation(internal.dailyNotes.saveDailyToIndex, {
          dailyNoteId: todayNote._id,
        });
        
        if (result.saved && result.noteId) {
          savedCount++;
          savedNoteIds.push(result.noteId);
          console.log(`Saved today's daily note: ${result.title}`);
        }
      } catch (error) {
        console.error(`Failed to save today's daily note:`, error);
      }
    }
    
    // Generate embeddings for all saved notes (for semantic search & knowledge graph)
    for (const noteId of savedNoteIds) {
      try {
        await ctx.runAction(api.embeddings.embedNote, { noteId: noteId as any });
        console.log(`Generated embedding for note ${noteId}`);
      } catch (error) {
        console.error(`Failed to generate embedding for note ${noteId}:`, error);
      }
    }
    
    // Recompute heatmap positions if any notes were saved
    if (savedNoteIds.length > 0) {
      try {
        await ctx.runAction(api.heatmap.computePositions, {});
        console.log(`Recomputed heatmap positions`);
      } catch (error) {
        console.error(`Failed to recompute heatmap positions:`, error);
      }
    }
    
    // ============================================
    // AI EXTRACTION: Process daily notes with agent
    // ============================================
    // After saving the raw daily note, run the AI agent to extract
    // valuable content and organize it into existing or new notes
    
    if (savedNoteIds.length > 0) {
      // Get today's daily note content for AI processing
      const dailyNote = await ctx.runQuery(internal.cronHandlers.getDailyNoteContent, { 
        date: today 
      });
      
      if (dailyNote && (dailyNote.notes.trim() || dailyNote.tasks.length > 0)) {
        try {
          console.log(`Running AI extraction agent on daily note...`);
          
          // Run AI extraction agent
          const extractionResult = await ctx.runAction(api.dailyProcessor.processDailyNotes, {
            dailyContent: dailyNote.notes,
            dailyTasks: dailyNote.tasks,
          });
          
          console.log(`AI extraction complete: ${extractionResult.summary}`);
          console.log(`Actions taken: ${extractionResult.actions.length}`);
          
          // Generate embeddings for any new/updated notes from extraction
          const extractedNoteIds: string[] = [];
          for (const action of extractionResult.actions) {
            if (action.noteId) {
              extractedNoteIds.push(action.noteId);
              try {
                await ctx.runAction(api.embeddings.embedNote, { noteId: action.noteId as any });
                console.log(`Generated embedding for extracted note: ${action.title}`);
              } catch (error) {
                console.error(`Failed to generate embedding for extracted note ${action.noteId}:`, error);
              }
            }
          }
          
          // Recompute heatmap if any notes were extracted/updated
          if (extractedNoteIds.length > 0) {
            try {
              await ctx.runAction(api.heatmap.computePositions, {});
              console.log(`Recomputed heatmap positions after extraction`);
            } catch (error) {
              console.error(`Failed to recompute heatmap after extraction:`, error);
            }
          }
        } catch (error) {
          console.error(`AI extraction failed:`, error);
        }
      }
    }
    
    return { savedCount };
  },
});

// Internal query to get all daily notes (for cron handler)
import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const getAllDailyNotes = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("dailyNotes").collect();
  },
});

// Get daily note content by date (for AI extraction)
export const getDailyNoteContent = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();
  },
});

// Snapshot taskBank tasks into dailyNotes.tasks for a given date
// This ensures the save-to-index flow captures accurate task data
export const snapshotTasksForDate = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    // Get all taskBank tasks scheduled for this date
    const tasks = await ctx.db
      .query("taskBank")
      .withIndex("by_scheduledDate", (q) => q.eq("scheduledDate", args.date))
      .collect();

    if (tasks.length === 0) return;

    // Build the tasks array for dailyNotes
    const snapshotTasks = tasks.map((t) => ({
      text: t.text,
      completed: t.status === "completed",
    }));

    // Update (or create) the dailyNotes entry
    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        tasks: snapshotTasks,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("dailyNotes", {
        date: args.date,
        notes: "",
        tasks: snapshotTasks,
        savedToIndex: false,
        updatedAt: Date.now(),
      });
    }
  },
});

// End-of-day task processing:
// - Completed tasks: keep as "completed" (they're done)
// - Active tasks still scheduled for today: unschedule them
//   so they appear in backlog tomorrow
export const unscheduleCompletedAndCarryOver = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("taskBank")
      .withIndex("by_scheduledDate", (q) => q.eq("scheduledDate", args.date))
      .collect();

    for (const task of tasks) {
      if (task.status === "active") {
        // Uncompleted task → unschedule so it appears in backlog tomorrow
        await ctx.db.patch(task._id, {
          scheduledDate: undefined,
        });
      }
      // Completed tasks keep their scheduledDate as historical record
    }
  },
});

