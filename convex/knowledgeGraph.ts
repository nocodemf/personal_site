import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Wiki-style link pattern: [[Note Title]]
const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

// Get all notes for link detection
export const getAllNotesForLinking = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("notes").collect();
  },
});

// Get a specific note
export const getNoteForLinking = internalQuery({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Update note with detected links and backlinks
export const updateNoteLinks = internalMutation({
  args: {
    id: v.id("notes"),
    relatedNotes: v.array(v.id("notes")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      relatedNotes: args.relatedNotes,
    });
  },
});

// Add a backlink to a note
export const addBacklink = internalMutation({
  args: {
    noteId: v.id("notes"),
    backlinkFrom: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return;

    const existingBacklinks = note.backlinks || [];
    if (!existingBacklinks.includes(args.backlinkFrom)) {
      await ctx.db.patch(args.noteId, {
        backlinks: [...existingBacklinks, args.backlinkFrom],
      });
    }
  },
});

// Remove a backlink from a note
export const removeBacklink = internalMutation({
  args: {
    noteId: v.id("notes"),
    backlinkFrom: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return;

    const existingBacklinks = note.backlinks || [];
    await ctx.db.patch(args.noteId, {
      backlinks: existingBacklinks.filter(id => id !== args.backlinkFrom),
    });
  },
});

// Detect links in a note and update related notes + backlinks
export const detectLinks = action({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args): Promise<{
    wikiLinks: string[];
    relatedNoteIds: Id<"notes">[];
    backlinksUpdated: number;
  }> => {
    // Get the source note
    const sourceNote = await ctx.runQuery(internal.knowledgeGraph.getNoteForLinking, { 
      id: args.noteId 
    });
    if (!sourceNote) {
      throw new Error("Note not found");
    }

    // Get all notes for matching
    const allNotes = await ctx.runQuery(internal.knowledgeGraph.getAllNotesForLinking, {});
    const otherNotes = allNotes.filter(n => n._id !== args.noteId);

    // Extract wiki-style links [[Note Title]]
    const wikiLinks: string[] = [];
    const relatedNoteIds: Id<"notes">[] = [];
    let match;

    while ((match = WIKI_LINK_REGEX.exec(sourceNote.body)) !== null) {
      const linkTitle = match[1].trim();
      wikiLinks.push(linkTitle);

      // Find matching note by title (case-insensitive)
      const matchingNote = otherNotes.find(
        n => n.title.toLowerCase() === linkTitle.toLowerCase()
      );

      if (matchingNote && !relatedNoteIds.includes(matchingNote._id)) {
        relatedNoteIds.push(matchingNote._id);
      }
    }

    // Also check for semantic similarity using existing embeddings
    // Only if the note has an embedding
    if (sourceNote.embedding && sourceNote.embedding.length > 0) {
      // Use vector search to find semantically similar notes
      const similarResults = await ctx.vectorSearch("notes", "by_embedding", {
        vector: sourceNote.embedding,
        limit: 5, // Get top 5 similar notes
      });

      // Add semantically similar notes (that aren't already linked)
      // Only include if similarity score is high enough (> 0.7)
      for (const result of similarResults) {
        if (
          result._id !== args.noteId && 
          !relatedNoteIds.includes(result._id) &&
          result._score > 0.7
        ) {
          relatedNoteIds.push(result._id);
        }
      }
    }

    // Get the note's current related notes to track changes
    const oldRelatedNotes = sourceNote.relatedNotes || [];

    // Update the source note's related notes
    await ctx.runMutation(internal.knowledgeGraph.updateNoteLinks, {
      id: args.noteId,
      relatedNotes: relatedNoteIds,
    });

    // Update backlinks:
    // 1. Add backlinks to newly linked notes
    let backlinksUpdated = 0;
    for (const targetId of relatedNoteIds) {
      if (!oldRelatedNotes.includes(targetId)) {
        await ctx.runMutation(internal.knowledgeGraph.addBacklink, {
          noteId: targetId,
          backlinkFrom: args.noteId,
        });
        backlinksUpdated++;
      }
    }

    // 2. Remove backlinks from notes that are no longer linked
    for (const oldTargetId of oldRelatedNotes) {
      if (!relatedNoteIds.includes(oldTargetId)) {
        await ctx.runMutation(internal.knowledgeGraph.removeBacklink, {
          noteId: oldTargetId,
          backlinkFrom: args.noteId,
        });
        backlinksUpdated++;
      }
    }

    return {
      wikiLinks,
      relatedNoteIds,
      backlinksUpdated,
    };
  },
});

// Get backlinks for a note (notes that link TO this note)
export const getBacklinks = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note || !note.backlinks || note.backlinks.length === 0) {
      return [];
    }

    // Fetch full data for each backlink
    const backlinks = await Promise.all(
      note.backlinks.map(async (backlinkId) => {
        const backlinkNote = await ctx.db.get(backlinkId);
        if (!backlinkNote) return null;
        return {
          _id: backlinkNote._id,
          title: backlinkNote.title,
          tags: backlinkNote.tags,
        };
      })
    );

    return backlinks.filter((b): b is NonNullable<typeof b> => b !== null);
  },
});

// Rebuild all knowledge graph connections (run once to initialize)
export const rebuildKnowledgeGraph = action({
  args: {},
  handler: async (ctx): Promise<{ processed: number; errors: number }> => {
    const allNotes = await ctx.runQuery(internal.knowledgeGraph.getAllNotesForLinking, {});

    let processed = 0;
    let errors = 0;

    for (const note of allNotes) {
      try {
        // Use the public detectLinks action
        await ctx.runAction(api.knowledgeGraph.detectLinks, { noteId: note._id });
        processed++;
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`Failed to process note ${note._id}:`, error);
        errors++;
      }
    }

    return { processed, errors };
  },
});

// Internal version of detectLinks for use in actions (kept for backwards compat)
export const detectLinksInternal = internalAction({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    // Same implementation as detectLinks
    const sourceNote = await ctx.runQuery(internal.knowledgeGraph.getNoteForLinking, { 
      id: args.noteId 
    });
    if (!sourceNote) return;

    const allNotes = await ctx.runQuery(internal.knowledgeGraph.getAllNotesForLinking, {});
    const otherNotes = allNotes.filter(n => n._id !== args.noteId);

    const relatedNoteIds: Id<"notes">[] = [];
    let match;

    // Reset regex
    WIKI_LINK_REGEX.lastIndex = 0;

    while ((match = WIKI_LINK_REGEX.exec(sourceNote.body)) !== null) {
      const linkTitle = match[1].trim();
      const matchingNote = otherNotes.find(
        n => n.title.toLowerCase() === linkTitle.toLowerCase()
      );
      if (matchingNote && !relatedNoteIds.includes(matchingNote._id)) {
        relatedNoteIds.push(matchingNote._id);
      }
    }

    if (sourceNote.embedding && sourceNote.embedding.length > 0) {
      const similarResults = await ctx.vectorSearch("notes", "by_embedding", {
        vector: sourceNote.embedding,
        limit: 5,
      });

      for (const result of similarResults) {
        if (
          result._id !== args.noteId && 
          !relatedNoteIds.includes(result._id) &&
          result._score > 0.7
        ) {
          relatedNoteIds.push(result._id);
        }
      }
    }

    const oldRelatedNotes = sourceNote.relatedNotes || [];

    await ctx.runMutation(internal.knowledgeGraph.updateNoteLinks, {
      id: args.noteId,
      relatedNotes: relatedNoteIds,
    });

    for (const targetId of relatedNoteIds) {
      if (!oldRelatedNotes.includes(targetId)) {
        await ctx.runMutation(internal.knowledgeGraph.addBacklink, {
          noteId: targetId,
          backlinkFrom: args.noteId,
        });
      }
    }

    for (const oldTargetId of oldRelatedNotes) {
      if (!relatedNoteIds.includes(oldTargetId)) {
        await ctx.runMutation(internal.knowledgeGraph.removeBacklink, {
          noteId: oldTargetId,
          backlinkFrom: args.noteId,
        });
      }
    }
  },
});

