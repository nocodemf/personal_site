import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { UMAP } from "umap-js";

// Get all notes with embeddings for UMAP
export const getNotesWithEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes.filter(note => note.embedding && note.embedding.length > 0);
  },
});

// Update a note's position
export const updateNotePosition = internalMutation({
  args: {
    id: v.id("notes"),
    positionX: v.float64(),
    positionY: v.float64(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      positionX: args.positionX,
      positionY: args.positionY,
      positionUpdatedAt: Date.now(),
    });
  },
});

// Compute UMAP positions for all notes
export const computePositions = action({
  args: {},
  handler: async (ctx): Promise<{ computed: number; errors: number }> => {
    // Get all notes with embeddings
    const notes = await ctx.runQuery(internal.heatmap.getNotesWithEmbeddings, {});
    
    if (notes.length < 2) {
      // Need at least 2 points for UMAP
      // For single note, place at center
      if (notes.length === 1) {
        await ctx.runMutation(internal.heatmap.updateNotePosition, {
          id: notes[0]._id,
          positionX: 0.5,
          positionY: 0.5,
        });
        return { computed: 1, errors: 0 };
      }
      return { computed: 0, errors: 0 };
    }

    // Extract embeddings as 2D array
    const embeddings = notes.map(note => note.embedding as number[]);

    // Configure UMAP
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: Math.min(15, Math.floor(notes.length / 2) || 2),
      minDist: 0.1,
      spread: 1.0,
    });

    // Fit and transform
    let positions: number[][];
    try {
      positions = umap.fit(embeddings);
    } catch (error) {
      console.error("UMAP fit error:", error);
      // Fallback to simple projection using first 2 dimensions
      positions = embeddings.map(emb => [emb[0] * 1000, emb[1] * 1000]);
    }

    // Normalize positions to 0-1 range
    const xVals = positions.map(p => p[0]);
    const yVals = positions.map(p => p[1]);
    const minX = Math.min(...xVals);
    const maxX = Math.max(...xVals);
    const minY = Math.min(...yVals);
    const maxY = Math.max(...yVals);
    
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Add padding (10%) to keep notes away from edges
    const padding = 0.1;
    const scale = 1 - 2 * padding;

    const normalizedPositions = positions.map(p => [
      padding + ((p[0] - minX) / rangeX) * scale,
      padding + ((p[1] - minY) / rangeY) * scale,
    ]);

    // Save positions to database
    let computed = 0;
    let errors = 0;

    for (let i = 0; i < notes.length; i++) {
      try {
        await ctx.runMutation(internal.heatmap.updateNotePosition, {
          id: notes[i]._id,
          positionX: normalizedPositions[i][0],
          positionY: normalizedPositions[i][1],
        });
        computed++;
      } catch (error) {
        console.error(`Failed to update position for note ${notes[i]._id}:`, error);
        errors++;
      }
    }

    return { computed, errors };
  },
});

// Get heatmap data (notes with positions)
export const getHeatmapData = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    
    return notes
      .filter(note => note.positionX !== undefined && note.positionY !== undefined)
      .map(note => ({
        _id: note._id,
        title: note.title,
        color: note.color,
        tags: note.tags,
        positionX: note.positionX!,
        positionY: note.positionY!,
        relatedNotes: note.relatedNotes || [],
        // Include density weight based on connections
        connectionCount: (note.relatedNotes?.length || 0) + (note.backlinks?.length || 0),
      }));
  },
});

// Get notes needing position update (new or recently updated)
export const getNotesNeedingPositionUpdate = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    
    return notes.filter(note => {
      // Has embedding but no position
      if (note.embedding && note.embedding.length > 0 && note.positionX === undefined) {
        return true;
      }
      // Position is older than embedding
      if (note.embeddingUpdatedAt && note.positionUpdatedAt && 
          note.embeddingUpdatedAt > note.positionUpdatedAt) {
        return true;
      }
      return false;
    }).length;
  },
});

