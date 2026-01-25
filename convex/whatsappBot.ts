import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ============================================
// QUERIES - Fetch context for the bot
// ============================================

// Get recent notes for context (last 10)
export const getRecentNotes = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db
      .query("notes")
      .order("desc")
      .take(10);
    
    return notes.map(note => ({
      id: note._id,
      title: note.title,
      body: note.body?.substring(0, 500) || "", // First 500 chars for context
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));
  },
});

// Search notes by keyword or tag
export const searchNotes = query({
  args: { 
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const searchTerm = args.query.toLowerCase();
    const limit = args.limit || 5;
    
    const allNotes = await ctx.db.query("notes").collect();
    
    // Simple search across title, body, and tags
    const matches = allNotes.filter(note => 
      note.title.toLowerCase().includes(searchTerm) ||
      note.body?.toLowerCase().includes(searchTerm) ||
      note.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    );
    
    return matches.slice(0, limit).map(note => ({
      id: note._id,
      title: note.title,
      body: note.body?.substring(0, 500) || "",
      tags: note.tags,
      createdAt: note.createdAt,
    }));
  },
});

// Get a specific note by ID
export const getNoteById = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note) return null;
    
    return {
      id: note._id,
      title: note.title,
      body: note.body,
      tags: note.tags,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  },
});

// Get all available tags
export const getAllTags = query({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db.query("tags").collect();
    return tags.map(t => t.name);
  },
});

// ============================================
// MUTATIONS - Create and update notes
// ============================================

// Create a new note from WhatsApp message
export const createNoteFromWhatsApp = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    tags: v.array(v.string()),
    source: v.optional(v.string()), // "whatsapp_text" or "whatsapp_voice"
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingNotes = await ctx.db.query("notes").collect();
    const order = existingNotes.length + 1;
    
    // Random color for the note
    const colors = ['#4A7CFF', '#E85454', '#B8B8B8', '#E8E854', '#E8A854', '#2A2A2A'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    // Get existing tags and add any new ones
    const existingTags = await ctx.db.query("tags").collect();
    const existingTagNames = existingTags.map(t => t.name.toLowerCase());
    
    for (const tagName of args.tags) {
      const normalizedTag = tagName.toLowerCase().replace('#', '');
      if (!existingTagNames.includes(normalizedTag)) {
        const firstLetter = normalizedTag.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstLetter) ? firstLetter : 'OTHER';
        
        await ctx.db.insert("tags", {
          name: normalizedTag,
          category: category,
        });
      }
    }
    
    const noteId = await ctx.db.insert("notes", {
      title: args.title,
      body: args.body,
      tags: args.tags,
      color,
      createdAt: now,
      updatedAt: now,
      order,
    });
    
    return { 
      success: true, 
      noteId,
      message: `Created note: "${args.title}"` 
    };
  },
});

// Append content to an existing note
export const appendToNote = mutation({
  args: {
    noteId: v.id("notes"),
    content: v.string(),
    addNewline: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) {
      return { success: false, message: "Note not found" };
    }
    
    const separator = args.addNewline !== false ? "\n\n" : " ";
    const newBody = (note.body || "") + separator + args.content;
    
    await ctx.db.patch(args.noteId, {
      body: newBody,
      updatedAt: Date.now(),
    });
    
    return { 
      success: true, 
      noteId: args.noteId,
      message: `Appended to note: "${note.title}"` 
    };
  },
});

// Update note title
export const updateNoteTitle = mutation({
  args: {
    noteId: v.id("notes"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, {
      title: args.title,
      updatedAt: Date.now(),
    });
    
    return { success: true, message: "Title updated" };
  },
});

// Add tags to a note
export const addTagsToNote = mutation({
  args: {
    noteId: v.id("notes"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) {
      return { success: false, message: "Note not found" };
    }
    
    // Merge existing tags with new ones (no duplicates)
    const allTags = [...new Set([...note.tags, ...args.tags])];
    
    await ctx.db.patch(args.noteId, {
      tags: allTags,
      updatedAt: Date.now(),
    });
    
    return { success: true, message: "Tags added" };
  },
});

// ============================================
// ACTIONS - Complex operations for the bot
// ============================================

// Find the best matching note for potential append
export const findRelatedNote = action({
  args: {
    content: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{
    found: boolean;
    noteId?: string;
    noteTitle?: string;
    similarity: string;
  }> => {
    // Get recent notes
    const recentNotes = await ctx.runQuery(api.whatsappBot.getRecentNotes, {});
    
    if (recentNotes.length === 0) {
      return { found: false, similarity: "no_notes_exist" };
    }
    
    const contentLower = args.content.toLowerCase();
    const contentWords = contentLower.split(/\s+/).filter(w => w.length > 3);
    
    // Score each note based on keyword overlap
    let bestMatch: { note: typeof recentNotes[0]; score: number } | null = null;
    
    for (const note of recentNotes) {
      let score = 0;
      const noteText = (note.title + " " + note.body).toLowerCase();
      
      // Check word overlap
      for (const word of contentWords) {
        if (noteText.includes(word)) {
          score += 1;
        }
      }
      
      // Boost score if tags match
      if (args.tags) {
        for (const tag of args.tags) {
          if (note.tags.includes(tag)) {
            score += 3;
          }
        }
      }
      
      // Check if this is the best match so far
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { note, score };
      }
    }
    
    // Require minimum score of 2 to consider it a match
    if (bestMatch && bestMatch.score >= 2) {
      return {
        found: true,
        noteId: bestMatch.note.id,
        noteTitle: bestMatch.note.title,
        similarity: bestMatch.score >= 5 ? "high" : "medium",
      };
    }
    
    return { found: false, similarity: "no_match" };
  },
});

// Get context summary for the bot
export const getBotContext = action({
  args: {},
  handler: async (ctx): Promise<{
    recentNotes: Array<{ title: string; tags: string[]; preview: string }>;
    availableTags: string[];
    totalNotes: number;
  }> => {
    const recentNotes = await ctx.runQuery(api.whatsappBot.getRecentNotes, {});
    const allTags = await ctx.runQuery(api.whatsappBot.getAllTags, {});
    
    return {
      recentNotes: recentNotes.map(n => ({
        title: n.title,
        tags: n.tags,
        preview: n.body.substring(0, 100) + (n.body.length > 100 ? "..." : ""),
      })),
      availableTags: allTags,
      totalNotes: recentNotes.length,
    };
  },
});

