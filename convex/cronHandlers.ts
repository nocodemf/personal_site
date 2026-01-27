import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Process all unsaved daily notes - runs at 11:45pm daily
export const processDailyNotesCron = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get all daily notes that haven't been saved yet
    const allDailyNotes = await ctx.runQuery(internal.cronHandlers.getAllDailyNotes, {});
    
    const today = new Date().toISOString().split('T')[0];
    let savedCount = 0;
    
    for (const dailyNote of allDailyNotes) {
      // Skip today's notes and already saved notes
      if (dailyNote.date === today || dailyNote.savedToIndex) continue;
      
      // Skip empty notes
      if (!dailyNote.notes.trim() && dailyNote.tasks.length === 0) continue;
      
      try {
        const result = await ctx.runMutation(internal.dailyNotes.saveDailyToIndex, {
          dailyNoteId: dailyNote._id,
        });
        
        if (result.saved) {
          savedCount++;
          console.log(`Saved daily note for ${dailyNote.date}: ${result.title}`);
        }
      } catch (error) {
        console.error(`Failed to save daily note for ${dailyNote.date}:`, error);
      }
    }
    
    // Also save today's note at 11:45pm
    const todayNote = allDailyNotes.find(n => n.date === today);
    if (todayNote && !todayNote.savedToIndex && (todayNote.notes.trim() || todayNote.tasks.length > 0)) {
      try {
        const result = await ctx.runMutation(internal.dailyNotes.saveDailyToIndex, {
          dailyNoteId: todayNote._id,
        });
        
        if (result.saved) {
          savedCount++;
          console.log(`Saved today's daily note: ${result.title}`);
        }
      } catch (error) {
        console.error(`Failed to save today's daily note:`, error);
      }
    }
    
    return { savedCount };
  },
});

// Internal query to get all daily notes (for cron handler)
import { internalQuery } from "./_generated/server";

export const getAllDailyNotes = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("dailyNotes").collect();
  },
});

