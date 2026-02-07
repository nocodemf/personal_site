import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction, action } from "./_generated/server";
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
      
      // Schedule AI summary regeneration (debounced: only if last summary is >30s old)
      const summaryAge = existing.aiSummaryUpdatedAt 
        ? Date.now() - existing.aiSummaryUpdatedAt 
        : Infinity;
      if (summaryAge > 30000) {
        await ctx.scheduler.runAfter(10000, internal.dailyNotes.generateTodaySummary, {});
      }
    } else {
      await ctx.db.insert("dailyNotes", {
        date: today,
        notes: args.notes,
        tasks: [],
        savedToIndex: false,
        updatedAt: Date.now(),
      });
      // First note of the day — schedule summary
      await ctx.scheduler.runAfter(10000, internal.dailyNotes.generateTodaySummary, {});
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
    
    // Get tasks from taskBank for today
    const bankTasks = await ctx.db
      .query("taskBank")
      .withIndex("by_scheduledDate", (q) => q.eq("scheduledDate", today))
      .collect();
    
    const notesContent = dailyNote?.notes?.trim() || '';
    const hasTasks = bankTasks.length > 0;
    
    if (!notesContent && !hasTasks) return { saved: false, noteId: null };
    if (dailyNote?.savedToIndex) return { saved: false, noteId: null };
    
    // Format date for title
    const date = new Date(today + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    // Format tasks from taskBank as part of the body
    const tasksText = hasTasks 
      ? `**Tasks:**\n${bankTasks.map(t => `[${t.status === 'completed' ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    
    const body = tasksText + notesContent;
    
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
    
    // Mark daily note as saved and clear content for fresh start
    if (dailyNote) {
      await ctx.db.patch(dailyNote._id, {
        savedToIndex: true,
        notes: "",
        tasks: bankTasks.map(t => ({ text: t.text, completed: t.status === 'completed' })),
      });
    }
    
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

// =============================================
// AI SUMMARY - Generates a one-sentence overview
// of what the user is thinking/doing today
// =============================================

// Internal query to get today's data for summary generation
export const getTodayForSummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    
    // Get today's notes
    const dailyNote = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    // Get today's tasks from taskBank (all scheduled for today)
    const allTodayTasks = await ctx.db
      .query("taskBank")
      .withIndex("by_scheduledDate", (q) => q.eq("scheduledDate", today))
      .collect();
    
    // Get recent notes for tone/voice learning (last 5 non-daily notes)
    const recentNotes = await ctx.db.query("notes").order("desc").take(10);
    const toneExamples = recentNotes
      .filter((n) => !n.tags.includes("daily"))
      .slice(0, 3)
      .map((n) => n.body.slice(0, 200));
    
    return {
      date: today,
      notes: dailyNote?.notes || "",
      tasks: allTodayTasks.map((t) => ({
        text: t.text,
        completed: t.status === "completed",
      })),
      currentSummary: dailyNote?.aiSummary || null,
      aiSummaryUpdatedAt: dailyNote?.aiSummaryUpdatedAt || null,
      toneExamples,
    };
  },
});

// Internal mutation to save AI summary
export const updateAiSummary = internalMutation({
  args: {
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const today = getTodayDateString();
    const existing = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        aiSummary: args.summary,
        aiSummaryUpdatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("dailyNotes", {
        date: today,
        notes: "",
        tasks: [],
        savedToIndex: false,
        updatedAt: Date.now(),
        aiSummary: args.summary,
        aiSummaryUpdatedAt: Date.now(),
      });
    }
  },
});

// Action: Generate AI summary of today's activity
// Triggered reactively when notes or tasks change (with debounce)
export const generateTodaySummary = internalAction({
  args: {},
  handler: async (ctx): Promise<{ summary: string | null }> => {
    const todayData = await ctx.runQuery(
      internal.dailyNotes.getTodayForSummary,
      {}
    );
    
    // Dedup: skip if summary was updated less than 25s ago
    if (todayData.aiSummaryUpdatedAt && Date.now() - todayData.aiSummaryUpdatedAt < 25000) {
      return { summary: todayData.currentSummary };
    }
    
    // Skip if nothing to summarize
    const hasNotes = todayData.notes.trim().length > 0;
    const hasTasks = todayData.tasks.length > 0;
    
    if (!hasNotes && !hasTasks) {
      return { summary: null };
    }
    
    // Build content for the AI
    const tasksText = todayData.tasks
      .map((t: { text: string; completed: boolean }) => `[${t.completed ? "done" : "todo"}] ${t.text}`)
      .join("\n");
    
    const content = [
      hasTasks ? `Tasks:\n${tasksText}` : "",
      hasNotes ? `Notes:\n${todayData.notes}` : "",
    ].filter(Boolean).join("\n\n");
    
    // Build tone examples from past notes
    const toneSection = todayData.toneExamples.length > 0
      ? `\n\nHere's how I normally write (match this tone exactly):\n${todayData.toneExamples.map((ex: string) => `"${ex}"`).join("\n")}`
      : "";
    
    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VERCEL_AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You're writing a one-liner that sits at the top of someone's personal dashboard. It should read like an internal thought — something they'd say to themselves.

Rules:
- ONE sentence. Max 20 words. No fluff.
- Write in second person ("you're..." or "mostly..."). Lowercase start is fine.
- Be SPECIFIC. Reference the actual topics, projects, or tasks they mentioned. Never be generic.
- Match their writing style: direct, casual, no corporate speak, slightly punchy.
- If they're clearly grinding on something, acknowledge it. If things are calm, keep it light.
- No quotes, no emoji, no exclamation marks. Just a clean sentence.
- Don't start with "You've been" every time — vary it. Sometimes start with the topic itself.`,
            },
            {
              role: "user",
              content: `Here's what I've been up to today:\n\n${content}${toneSection}`,
            },
          ],
          max_tokens: 60,
          temperature: 0.8,
        }),
      });
      
      if (!response.ok) {
        console.error("AI summary API error:", response.statusText);
        return { summary: null };
      }
      
      const data = await response.json();
      const summary = data.choices?.[0]?.message?.content?.trim()
        ?.replace(/^["']|["']$/g, ""); // Strip any wrapping quotes
      
      if (summary) {
        await ctx.runMutation(internal.dailyNotes.updateAiSummary, { summary });
        console.log(`Generated today summary: "${summary}"`);
        return { summary };
      }
      
      return { summary: null };
    } catch (error) {
      console.error("Failed to generate today summary:", error);
      return { summary: null };
    }
  },
});

// Query to get today's AI summary (for the frontend)
export const getTodaySummary = query({
  args: {},
  handler: async (ctx) => {
    const today = getTodayDateString();
    const dailyNote = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    
    return {
      summary: dailyNote?.aiSummary || null,
      updatedAt: dailyNote?.aiSummaryUpdatedAt || null,
    };
  },
});

