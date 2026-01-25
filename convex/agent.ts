import { Agent } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Create Vercel AI Gateway client
const gateway = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
});

// Create the agent with Gemini via Vercel AI Gateway
export const noteAnalyzer = new Agent(components.agent, {
  name: "noteAnalyzer",
  languageModel: gateway("google/gemini-2.5-flash"),
  instructions: `You analyze notes. Be extremely concise. No fluff. JSON only.`,
});

// Internal query to get all notes for context
export const getAllNotesForContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes.map(note => ({
      id: note._id,
      title: note.title,
      body: note.body,
      tags: note.tags,
    }));
  },
});

// Internal query to get a specific note
export const getNoteForAnalysis = internalQuery({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Internal mutation to update note with AI analysis
export const updateNoteAnalysis = internalMutation({
  args: {
    id: v.id("notes"),
    bullets: v.array(v.string()),
    furtherQuestions: v.array(v.string()),
    aiSummary: v.string(),
    relatedNotes: v.array(v.id("notes")),
    links: v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      bullets: args.bullets,
      furtherQuestions: args.furtherQuestions,
      aiSummary: args.aiSummary,
      relatedNotes: args.relatedNotes,
      links: args.links,
      lastAnalyzed: Date.now(),
    });
  },
});

// Main action to analyze a note
export const analyzeNote = action({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args): Promise<{
    bullets: string[];
    furtherQuestions: string[];
    aiSummary: string;
    relatedNotes: Id<"notes">[];
    links: { url: string; title?: string }[];
  }> => {
    // Get the note to analyze
    const note = await ctx.runQuery(internal.agent.getNoteForAnalysis, { id: args.noteId });
    if (!note) {
      throw new Error("Note not found");
    }

    // Get all other notes for context (for related notes and further questions)
    const allNotes = await ctx.runQuery(internal.agent.getAllNotesForContext, {});
    const otherNotes = allNotes.filter(n => n.id !== args.noteId);

    // Build context about all notes in the knowledge base
    const knowledgeBaseContext = otherNotes.map(n => 
      `Note: "${n.title}" (ID: ${n.id})\nTags: ${n.tags.join(', ')}\nContent Preview: ${n.body.substring(0, 300)}...`
    ).join('\n\n---\n\n');

    // Extract links from the note body
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
    const extractedUrls = note.body.match(urlRegex) || [];
    const links = extractedUrls.map(url => ({ url, title: undefined }));

    // Create a thread for the agent
    const { threadId } = await noteAnalyzer.createThread(ctx, {});

    // Generate bullets, summary, questions, and find related notes
    const result = await noteAnalyzer.generateText(
      ctx, 
      { threadId },
      {
        prompt: `TITLE: ${note.title}
TAGS: ${note.tags.join(', ') || 'none'}
CONTENT: ${note.body || 'empty'}

OTHER NOTES IN DB:
${knowledgeBaseContext || "none"}

OUTPUT JSON ONLY:
{
  "bullets": [max 10 words each, 3-5 items, core insights only],
  "aiSummary": "2 sentences max. What is this + why it matters.",
  "furtherQuestions": [direct questions, 3-5, challenge thinking, connect to other notes],
  "relatedNoteIds": [only IDs from OTHER NOTES that directly relate, empty if none]
}

RULES:
- bullets: MAX 10 WORDS EACH. No filler. Core idea only.
- questions: Direct. No "How might you..." - just ask it.
- summary: 2 sentences. Dense. No fluff.
- related: Only include if genuinely connected. Empty array is fine.

JSON ONLY. NO MARKDOWN. NO EXPLANATION.`,
      }
    );

    // Parse the response
    let parsed: {
      bullets: string[];
      aiSummary: string;
      furtherQuestions: string[];
      relatedNoteIds: string[];
    };

    try {
      // Extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (e) {
      // Fallback if parsing fails
      parsed = {
        bullets: ["Unable to extract bullets"],
        aiSummary: "Unable to generate summary",
        furtherQuestions: ["What are the key takeaways from this note?"],
        relatedNoteIds: [],
      };
    }

    // Validate and filter related note IDs
    const validRelatedNotes = parsed.relatedNoteIds
      .filter(id => otherNotes.some(n => n.id === id))
      .map(id => id as Id<"notes">);

    const analysisResult = {
      bullets: parsed.bullets,
      furtherQuestions: parsed.furtherQuestions,
      aiSummary: parsed.aiSummary,
      relatedNotes: validRelatedNotes,
      links,
    };

    // Save the analysis to the note
    await ctx.runMutation(internal.agent.updateNoteAnalysis, {
      id: args.noteId,
      ...analysisResult,
    });

    return analysisResult;
  },
});

