import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Notes queries
export const getNotes = query({
  args: { tags: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_order")
      .collect();
    
    // Filter by tags if provided (tags without # prefix)
    if (args.tags && args.tags.length > 0) {
      return notes.filter(note => 
        args.tags!.some(tag => note.tags.includes(tag.replace('#', '')))
      );
    }
    return notes;
  },
});

export const getNote = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note) return null;
    
    // Get related notes if any
    let relatedNotesData: any[] = [];
    if (note.relatedNotes && note.relatedNotes.length > 0) {
      for (const relatedId of note.relatedNotes) {
        const related = await ctx.db.get(relatedId);
        if (related) {
          relatedNotesData.push(related);
        }
      }
    }
    
    return {
      ...note,
      relatedNotesData,
    };
  },
});

export const getTags = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tags")
      .withIndex("by_category")
      .collect();
  },
});

export const getTagsByCategory = query({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_category")
      .collect();
    
    // Group by category
    const grouped: Record<string, string[]> = {};
    for (const tag of tags) {
      if (!grouped[tag.category]) {
        grouped[tag.category] = [];
      }
      grouped[tag.category].push(`#${tag.name}`);
    }
    return grouped;
  },
});

export const createNote = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    color: v.string(),
    tags: v.array(v.string()),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Get existing tags
    const existingTags = await ctx.db.query("tags").collect();
    const existingTagNames = existingTags.map(t => t.name.toLowerCase());
    
    // Add any new tags to the tags table
    for (const tagName of args.tags) {
      const normalizedTag = tagName.toLowerCase().replace('#', '');
      if (!existingTagNames.includes(normalizedTag)) {
        // Determine category based on first letter
        const firstLetter = normalizedTag.charAt(0).toUpperCase();
        const category = /[A-Z]/.test(firstLetter) ? firstLetter : 'OTHER';
        
        await ctx.db.insert("tags", {
          name: normalizedTag,
          category: category,
        });
      }
    }
    
    return await ctx.db.insert("notes", {
      ...args,
      createdAt: now,
      updatedAt: now,
      bullets: [],
      furtherQuestions: [],
      aiSummary: undefined,
      relatedNotes: [],
      links: [],
    });
  },
});

export const updateNoteBody = mutation({
  args: {
    id: v.id("notes"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      body: args.body,
      updatedAt: Date.now(),
    });
  },
});

export const getContent = query({
  args: { section: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.section) {
      return await ctx.db
        .query("content")
        .withIndex("by_section", (q) => q.eq("section", args.section!))
        .collect();
    }
    return await ctx.db.query("content").collect();
  },
});

export const getNavigation = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("navigation")
      .withIndex("by_order")
      .collect();
  },
});

export const getVentures = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.category) {
      return await ctx.db
        .query("ventures")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
    }
    return await ctx.db.query("ventures").collect();
  },
});


export const sendMessage = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      name: args.name,
      email: args.email,
      message: args.message,
      read: false,
      createdAt: Date.now(),
    });
  },
});

