import { v } from "convex/values";
import { mutation, query, internalMutation, action } from "./_generated/server";
import { api, internal } from "./_generated/api";

// Get today's date string in YYYY-MM-DD format
function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// Get or create today's daily note
export const getToday = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    if (existing) {
      return existing;
    }
    
    // Return empty structure if no entry exists yet
    return {
      date: today,
      notes: "",
      tasks: [],
      savedToIndex: false,
      updatedAt: Date.now(),
    };
  },
});

// Update today's notes content
export const updateNotes = mutation({
  args: {
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        notes: args.notes,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("dailyNotes", {
        date: today,
        notes: args.notes,
        tasks: [],
        savedToIndex: false,
        updatedAt: Date.now(),
      });
    }
  },
});

// Update today's tasks
export const updateTasks = mutation({
  args: {
    tasks: v.array(v.object({
      text: v.string(),
      completed: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        tasks: args.tasks,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("dailyNotes", {
        date: today,
        notes: "",
        tasks: args.tasks,
        savedToIndex: false,
        updatedAt: Date.now(),
      });
    }
  },
});

// Internal mutation to save daily note to index (called by cron)
// Returns the noteId so the cron handler can trigger embedding generation
export const saveDailyToIndex = internalMutation({
  args: {
    dailyNoteId: v.id("dailyNotes"),
  },
  handler: async (ctx, args) => {
    const dailyNote = await ctx.db.get(args.dailyNoteId);
    if (!dailyNote || dailyNote.savedToIndex) return { saved: false, noteId: null };
    
    // Skip if empty
    if (!dailyNote.notes.trim() && dailyNote.tasks.length === 0) {
      return { saved: false, noteId: null };
    }
    
    // Format date for title
    const date = new Date(dailyNote.date + 'T12:00:00'); // Add time to avoid timezone issues
    const dateStr = date.toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    // Format tasks as part of the body
    const tasksText = dailyNote.tasks.length > 0 
      ? `**Tasks:**\n${dailyNote.tasks.map(t => `[${t.completed ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    
    const body = tasksText + (dailyNote.notes || '');
    
    // Get note count for order
    const allNotes = await ctx.db.query("notes").collect();
    const noteCount = allNotes.length;
    
    // Create the permanent note
    const noteId = await ctx.db.insert("notes", {
      title: dateStr,
      body,
      color: '#B8B8B8',
      tags: ['daily'],
      order: noteCount + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Mark as saved
    await ctx.db.patch(args.dailyNoteId, {
      savedToIndex: true,
    });
    
    return { saved: true, title: dateStr, noteId };
  },
});

// Get all unsaved daily notes (for cron job)
export const getUnsavedDailyNotes = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    const allDailyNotes = await ctx.db.query("dailyNotes").collect();
    
    // Return notes that are not today and not yet saved
    return allDailyNotes.filter(
      note => note.date !== today && !note.savedToIndex && (note.notes.trim() || note.tasks.length > 0)
    );
  },
});

// Internal mutation for manual save (returns noteId for embedding generation)
export const manualSaveToIndexMutation = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    const dailyNote = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    if (!dailyNote || dailyNote.savedToIndex) return { saved: false, noteId: null };
    
    // Skip if empty
    if (!dailyNote.notes.trim() && dailyNote.tasks.length === 0) {
      return { saved: false, noteId: null };
    }
    
    // Format date for title
    const date = new Date(dailyNote.date + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    // Format tasks as part of the body
    const tasksText = dailyNote.tasks.length > 0 
      ? `**Tasks:**\n${dailyNote.tasks.map(t => `[${t.completed ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    
    const body = tasksText + (dailyNote.notes || '');
    
    // Get note count for order
    const allNotes = await ctx.db.query("notes").collect();
    const noteCount = allNotes.length;
    
    // Create the permanent note
    const noteId = await ctx.db.insert("notes", {
      title: dateStr,
      body,
      color: '#B8B8B8',
      tags: ['daily'],
      order: noteCount + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Mark as saved and clear content for fresh start
    await ctx.db.patch(dailyNote._id, {
      savedToIndex: true,
      notes: "",
      tasks: [],
    });
    
    return { saved: true, title: dateStr, noteId };
  },
});

// Manual save to index action (for the "save to index" button)
// This action saves the note AND generates embedding + updates heatmap
export const manualSaveToIndex = action({
  args: {},
  handler: async (ctx): Promise<{ saved: boolean; title: string | null }> => {
    // Save the note
    const result: { saved: boolean; noteId: any; title?: string } = await ctx.runMutation(
      internal.dailyNotes.manualSaveToIndexMutation, 
      {}
    );
    
    if (result.saved && result.noteId) {
      // Generate embedding for semantic search & knowledge graph
      try {
        await ctx.runAction(api.embeddings.embedNote, { noteId: result.noteId });
        console.log(`Generated embedding for manually saved note`);
      } catch (error) {
        console.error(`Failed to generate embedding:`, error);
      }
      
      // Recompute heatmap positions
      try {
        await ctx.runAction(api.heatmap.computePositions, {});
        console.log(`Recomputed heatmap positions`);
      } catch (error) {
        console.error(`Failed to recompute heatmap positions:`, error);
      }
    }
    
    return { saved: result.saved, title: result.title || null };
  },
});

