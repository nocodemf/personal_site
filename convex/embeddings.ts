import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { internal, api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// OpenAI embedding via Vercel AI Gateway
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// Generate embedding using OpenAI via Vercel AI Gateway
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://ai-gateway.vercel.sh/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.VERCEL_AI_GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Get note for embedding
export const getNoteForEmbedding = internalQuery({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Get all notes without embeddings
export const getNotesWithoutEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes.filter(note => !note.embedding || note.embedding.length === 0);
  },
});

// Save embedding to database
export const updateNoteEmbedding = internalMutation({
  args: {
    id: v.id("notes"),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      embedding: args.embedding,
      embeddingUpdatedAt: Date.now(),
    });
  },
});

// Generate and save embedding for a single note
export const embedNote = action({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args): Promise<{ success: boolean; dimensions?: number }> => {
    // Get the note
    const note = await ctx.runQuery(internal.embeddings.getNoteForEmbedding, { id: args.noteId });
    if (!note) {
      throw new Error("Note not found");
    }

    // Combine title, body, and tags for embedding
    const textToEmbed = `${note.title}\n\n${note.body}\n\nTags: ${note.tags.join(", ")}`;

    // Generate embedding
    const embedding = await generateEmbedding(textToEmbed);

    // Save to database
    await ctx.runMutation(internal.embeddings.updateNoteEmbedding, {
      id: args.noteId,
      embedding,
    });

    return { success: true, dimensions: embedding.length };
  },
});

// Batch embed all notes without embeddings
export const embedAllNotes = action({
  args: {},
  handler: async (ctx): Promise<{ processed: number; failed: number }> => {
    const notesWithoutEmbeddings = await ctx.runQuery(
      internal.embeddings.getNotesWithoutEmbeddings,
      {}
    );

    let processed = 0;
    let failed = 0;

    for (const note of notesWithoutEmbeddings) {
      try {
        // Combine title, body, and tags for embedding
        const textToEmbed = `${note.title}\n\n${note.body}\n\nTags: ${note.tags.join(", ")}`;
        
        // Generate embedding
        const embedding = await generateEmbedding(textToEmbed);

        // Save to database
        await ctx.runMutation(internal.embeddings.updateNoteEmbedding, {
          id: note._id,
          embedding,
        });

        processed++;
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to embed note ${note._id}:`, error);
        failed++;
      }
    }

    return { processed, failed };
  },
});

// Mark embedding as stale (clear it when content changes)
export const clearEmbedding = internalMutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      embedding: undefined,
      embeddingUpdatedAt: undefined,
    });
  },
});

// Create note with automatic embedding
export const createNoteWithEmbedding = action({
  args: {
    title: v.string(),
    body: v.string(),
    color: v.string(),
    tags: v.array(v.string()),
    order: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"notes">> => {
    // Create the note using the existing mutation
    const noteId = await ctx.runMutation(api.content.createNote, args);

    // Generate embedding in background (don't block)
    try {
      const textToEmbed = `${args.title}\n\n${args.body}\n\nTags: ${args.tags.join(", ")}`;
      const embedding = await generateEmbedding(textToEmbed);
      await ctx.runMutation(internal.embeddings.updateNoteEmbedding, {
        id: noteId,
        embedding,
      });
    } catch (error) {
      console.error("Failed to embed new note:", error);
      // Note is still created, embedding can be generated later
    }

    return noteId;
  },
});

// Update note body and regenerate embedding
export const updateNoteWithEmbedding = action({
  args: {
    id: v.id("notes"),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    // Update the note body
    await ctx.runMutation(api.content.updateNoteBody, {
      id: args.id,
      body: args.body,
    });

    // Get the full note for embedding context
    const note = await ctx.runQuery(internal.embeddings.getNoteForEmbedding, { id: args.id });
    if (!note) {
      return { success: false };
    }

    // Regenerate embedding
    try {
      const textToEmbed = `${note.title}\n\n${args.body}\n\nTags: ${note.tags.join(", ")}`;
      const embedding = await generateEmbedding(textToEmbed);
      await ctx.runMutation(internal.embeddings.updateNoteEmbedding, {
        id: args.id,
        embedding,
      });
    } catch (error) {
      console.error("Failed to re-embed note:", error);
      // Mark embedding as stale
      await ctx.runMutation(internal.embeddings.clearEmbedding, { id: args.id });
    }

    return { success: true };
  },
});

// Semantic search using vector similarity
export const semanticSearch = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"notes">;
    title: string;
    body: string;
    tags: string[];
    aiSummary?: string;
    score: number;
  }>> => {
    const limit = args.limit || 10;

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(args.query);

    // Search using vector index
    // Note: filterFields in vectorIndex must be primitive types, not arrays
    // For now, we'll filter by tags client-side after fetching results
    const results = await ctx.vectorSearch("notes", "by_embedding", {
      vector: queryEmbedding,
      limit: limit * 2, // Fetch extra to allow for filtering
    });

    // Fetch full note data for results
    const notesWithScores = await Promise.all(
      results.map(async (result) => {
        const note = await ctx.runQuery(internal.embeddings.getNoteForEmbedding, {
          id: result._id,
        });
        return {
          _id: result._id,
          title: note?.title || "",
          body: note?.body || "",
          tags: note?.tags || [],
          aiSummary: note?.aiSummary,
          score: result._score,
        };
      })
    );

    // Filter by tags client-side if specified
    let filtered = notesWithScores;
    if (args.tags && args.tags.length > 0) {
      filtered = notesWithScores.filter(note =>
        args.tags!.some(tag => note.tags.includes(tag))
      );
    }

    // Return up to the requested limit
    return filtered.slice(0, limit);
  },
});

