import { Agent } from "@convex-dev/agent";
import { components, internal, api } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Vercel AI Gateway client - Gemini 2.5 Flash
const gateway = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
});

// Similarity threshold for candidate pairs
// 0.85+ = very likely same topic, worth reviewing
const MERGE_CANDIDATE_THRESHOLD = 0.85;

// Maximum pairs to review per run (to limit AI costs)
const MAX_PAIRS_PER_RUN = 10;

// Note Consolidation Agent
export const consolidator = new Agent(components.agent, {
  name: "noteConsolidator",
  languageModel: gateway("google/gemini-2.5-flash"),
  instructions: `You are a knowledge base curator. Your job is to review pairs of notes and decide if they should be merged into one.

MERGE when:
- Two notes cover the same topic with overlapping content
- One note is a subset of the other
- They would be more useful as a single comprehensive note

DON'T MERGE when:
- Notes cover different aspects of a broader topic (keep them separate for clarity)
- One is a specific case study and the other is a general framework
- They represent different time periods and the evolution matters
- They are genuinely distinct topics that happen to share keywords

Be CONSERVATIVE. Only merge when it genuinely reduces redundancy without losing nuance.

OUTPUT: Valid JSON only.`,
});

// =============================================
// INTERNAL QUERIES
// =============================================

// Get all non-daily notes with embeddings for comparison
export const getNotesWithEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes
      .filter((n) => !n.tags.includes("daily") && n.embedding && n.embedding.length > 0)
      .map((n) => ({
        _id: n._id,
        title: n.title,
        body: n.body,
        tags: n.tags,
        aiSummary: n.aiSummary,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  },
});

// Get full note content for merge review
export const getNotePair = internalQuery({
  args: {
    noteAId: v.id("notes"),
    noteBId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const noteA = await ctx.db.get(args.noteAId);
    const noteB = await ctx.db.get(args.noteBId);
    if (!noteA || !noteB) return null;
    return { noteA, noteB };
  },
});

// =============================================
// INTERNAL MUTATIONS
// =============================================

// Merge note B into note A (A is the primary, B gets deleted)
export const mergeNotes = internalMutation({
  args: {
    primaryId: v.id("notes"),
    secondaryId: v.id("notes"),
    mergedTitle: v.string(),
    mergedBody: v.string(),
    mergedTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const primary = await ctx.db.get(args.primaryId);
    const secondary = await ctx.db.get(args.secondaryId);
    if (!primary || !secondary) return { success: false, reason: "Note not found" };

    // Update the primary note with merged content
    await ctx.db.patch(args.primaryId, {
      title: args.mergedTitle,
      body: args.mergedBody,
      tags: args.mergedTags,
      updatedAt: Date.now(),
      // Clear AI analysis so it gets re-analyzed
      bullets: undefined,
      furtherQuestions: undefined,
      aiSummary: undefined,
      relatedNotes: undefined,
      lastAnalyzed: undefined,
      // Clear embedding so it gets re-generated
      embedding: undefined,
      embeddingUpdatedAt: undefined,
    });

    // Remove backlinks pointing to the secondary note from other notes
    const allNotes = await ctx.db.query("notes").collect();
    for (const note of allNotes) {
      if (note.backlinks && note.backlinks.includes(args.secondaryId)) {
        const updatedBacklinks = note.backlinks.filter(
          (id) => id !== args.secondaryId
        );
        // Add primary as backlink if not already there
        if (!updatedBacklinks.includes(args.primaryId)) {
          updatedBacklinks.push(args.primaryId);
        }
        await ctx.db.patch(note._id, { backlinks: updatedBacklinks });
      }
      // Also update relatedNotes references
      if (note.relatedNotes && note.relatedNotes.includes(args.secondaryId)) {
        const updatedRelated = note.relatedNotes.filter(
          (id) => id !== args.secondaryId
        );
        if (note._id !== args.primaryId && !updatedRelated.includes(args.primaryId)) {
          updatedRelated.push(args.primaryId);
        }
        await ctx.db.patch(note._id, { relatedNotes: updatedRelated });
      }
    }

    // Delete the secondary note
    await ctx.db.delete(args.secondaryId);

    return {
      success: true,
      primaryTitle: args.mergedTitle,
      deletedTitle: secondary.title,
    };
  },
});

// =============================================
// MAIN CONSOLIDATION ACTION
// =============================================

export const consolidateNotes = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    candidatesFound: number;
    merged: number;
    skipped: number;
    details: Array<{
      noteA: string;
      noteB: string;
      action: "merged" | "kept_separate";
      reason: string;
      similarity: number;
    }>;
  }> => {
    // Step 1: Get all eligible notes
    const notes = await ctx.runQuery(
      internal.noteConsolidator.getNotesWithEmbeddings,
      {}
    );

    if (notes.length < 2) {
      return { candidatesFound: 0, merged: 0, skipped: 0, details: [] };
    }

    console.log(`Checking ${notes.length} notes for consolidation candidates...`);

    // Step 2: For each note, find similar notes using vector search
    // Collect unique candidate pairs
    const seen = new Set<string>();
    const candidates: Array<{
      noteAId: Id<"notes">;
      noteBId: Id<"notes">;
      noteATitle: string;
      noteBTitle: string;
      similarity: number;
    }> = [];

    for (const note of notes) {
      // Use semantic search to find similar notes
      const similar = await ctx.runAction(api.embeddings.semanticSearch, {
        query: `${note.title}\n${note.body.substring(0, 500)}`,
        limit: 5,
      });

      for (const match of similar) {
        // Skip self-matches and daily notes
        if (match._id === note._id) continue;
        if (match.tags.includes("daily")) continue;
        if (match.score < MERGE_CANDIDATE_THRESHOLD) continue;

        // Create a canonical pair key to avoid duplicates
        const pairKey = [note._id, match._id].sort().join(":");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        candidates.push({
          noteAId: note._id,
          noteBId: match._id,
          noteATitle: note.title,
          noteBTitle: match.title,
          similarity: match.score,
        });
      }
    }

    // Sort by similarity (highest first) and limit
    candidates.sort((a, b) => b.similarity - a.similarity);
    const toReview = candidates.slice(0, MAX_PAIRS_PER_RUN);

    console.log(
      `Found ${candidates.length} candidate pairs, reviewing top ${toReview.length}`
    );

    if (toReview.length === 0) {
      return { candidatesFound: 0, merged: 0, skipped: 0, details: [] };
    }

    // Step 3: For each candidate pair, ask the AI to review
    let merged = 0;
    let skipped = 0;
    const details: Array<{
      noteA: string;
      noteB: string;
      action: "merged" | "kept_separate";
      reason: string;
      similarity: number;
    }> = [];

    for (const candidate of toReview) {
      const pair = await ctx.runQuery(internal.noteConsolidator.getNotePair, {
        noteAId: candidate.noteAId,
        noteBId: candidate.noteBId,
      });

      if (!pair) continue;

      const { noteA, noteB } = pair;

      // Ask the AI to decide
      const { threadId } = await consolidator.createThread(ctx, {});

      const decision = await consolidator.generateText(
        ctx,
        { threadId },
        {
          prompt: `Review these two notes and decide if they should be merged:

NOTE A:
Title: "${noteA.title}"
Tags: [${noteA.tags.join(", ")}]
Content:
${noteA.body}

---

NOTE B:
Title: "${noteB.title}"
Tags: [${noteB.tags.join(", ")}]  
Content:
${noteB.body}

---

Semantic similarity score: ${candidate.similarity.toFixed(3)}

Decide:
1. Should these be MERGED into one note? Or KEPT SEPARATE?
2. If merged: which is the better "primary" note to build on, and what should the consolidated note look like?

OUTPUT JSON:
{
  "decision": "merge" | "keep_separate",
  "reason": "one sentence why",
  "mergedTitle": "if merging, the best title for the combined note",
  "mergedBody": "if merging, the complete combined content (well-structured, no redundancy, preserve all unique info)",
  "mergedTags": ["if merging, unified tags array"],
  "primaryNoteId": "if merging, the ID of the note to keep (A=${noteA._id} or B=${noteB._id})"
}

RULES:
- Preserve ALL unique information from both notes
- Remove redundant/duplicate content
- Structure the merged content logically
- If one note is clearly better written, use it as the base
- The merged body should be a COMPLETE, well-formatted note - not a lazy concatenation
- Use markdown formatting for structure
- Unify tags (combine both, remove duplicates)
- JSON ONLY`,
        }
      );

      // Parse decision
      let parsed: {
        decision: "merge" | "keep_separate";
        reason: string;
        mergedTitle?: string;
        mergedBody?: string;
        mergedTags?: string[];
        primaryNoteId?: string;
      };

      try {
        const jsonMatch = decision.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON in response");
        }
      } catch (e) {
        console.error(`Failed to parse consolidation decision for ${noteA.title} + ${noteB.title}:`, e);
        skipped++;
        details.push({
          noteA: noteA.title,
          noteB: noteB.title,
          action: "kept_separate",
          reason: "Failed to parse AI decision",
          similarity: candidate.similarity,
        });
        continue;
      }

      if (parsed.decision === "merge" && parsed.mergedTitle && parsed.mergedBody) {
        // Determine primary and secondary
        const primaryId =
          parsed.primaryNoteId === String(noteB._id)
            ? noteB._id
            : noteA._id;
        const secondaryId = primaryId === noteA._id ? noteB._id : noteA._id;

        console.log(
          `Merging "${noteA.title}" + "${noteB.title}" → "${parsed.mergedTitle}"`
        );

        const result = await ctx.runMutation(
          internal.noteConsolidator.mergeNotes,
          {
            primaryId,
            secondaryId,
            mergedTitle: parsed.mergedTitle,
            mergedBody: parsed.mergedBody,
            mergedTags: parsed.mergedTags || [
              ...new Set([...noteA.tags, ...noteB.tags]),
            ],
          }
        );

        if (result.success) {
          merged++;

          // Regenerate embedding for the merged note
          try {
            await ctx.runAction(api.embeddings.embedNote, {
              noteId: primaryId,
            });
          } catch (error) {
            console.error("Failed to re-embed merged note:", error);
          }
        }

        details.push({
          noteA: noteA.title,
          noteB: noteB.title,
          action: "merged",
          reason: parsed.reason,
          similarity: candidate.similarity,
        });
      } else {
        skipped++;
        details.push({
          noteA: noteA.title,
          noteB: noteB.title,
          action: "kept_separate",
          reason: parsed.reason,
          similarity: candidate.similarity,
        });
      }
    }

    // Recompute heatmap if any merges happened
    if (merged > 0) {
      try {
        await ctx.runAction(api.heatmap.computePositions, {});
        console.log("Recomputed heatmap positions after consolidation");
      } catch (error) {
        console.error("Failed to recompute heatmap:", error);
      }
    }

    console.log(
      `Consolidation complete: ${merged} merged, ${skipped} kept separate`
    );

    return {
      candidatesFound: candidates.length,
      merged,
      skipped,
      details,
    };
  },
});

