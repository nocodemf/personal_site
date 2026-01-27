import { Agent } from "@convex-dev/agent";
import { components, internal, api } from "./_generated/api";
import { createOpenAI } from "@ai-sdk/openai";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Vercel AI Gateway client - using Gemini 2.5 Flash for:
// - Fast processing (important for scheduled tasks)
// - Good structured JSON output
// - Cost effective for daily runs
// - Strong enough for content analysis and categorization
const gateway = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
});

// Semantic similarity threshold for matching to existing notes
// 0.70 = reasonably confident match (tested to balance precision/recall)
const SEMANTIC_MATCH_THRESHOLD = 0.70;

// Daily Note Processor Agent
// Purpose: EXTRACT valuable content from daily notes
// Note: Matching to existing notes is done via SEMANTIC SEARCH, not LLM guessing
export const dailyProcessor = new Agent(components.agent, {
  name: "dailyProcessor",
  languageModel: gateway("google/gemini-2.5-flash"),
  instructions: `You are a personal knowledge curator. Your job is to EXTRACT valuable content from daily notes.

ROLE: Identify insights, ideas, learnings worth preserving long-term.

BEHAVIOR:
- Find content worth keeping (insights, decisions, learnings, ideas, reflections, important facts)
- Skip casual/temporary content (weather, meals, small talk) - it stays in the daily note
- Extract the EXACT valuable text, don't paraphrase
- Suggest a title and tags for each chunk (we'll use semantic search to find matches)

OUTPUT: Always respond with valid JSON only. No markdown, no explanation.`,
});

// Get all notes for context (excluding daily notes)
export const getAllNotesContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes
      .filter(n => !n.tags.includes('daily')) // Exclude daily notes
      .map(note => ({
        id: note._id,
        title: note.title,
        body: note.body.substring(0, 400),
        tags: note.tags,
        aiSummary: note.aiSummary,
      }));
  },
});

// Append content to an existing note
export const appendToExistingNote = internalMutation({
  args: {
    noteId: v.id("notes"),
    content: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return { success: false };
    
    const timestamp = new Date().toLocaleDateString('en-GB');
    const newBody = note.body + `\n\n---\n*Added from daily note (${timestamp}):*\n\n${args.content}`;
    
    await ctx.db.patch(args.noteId, {
      body: newBody,
      updatedAt: Date.now(),
    });
    
    return { success: true, noteTitle: note.title };
  },
});

// Create a new note from extracted content
export const createExtractedNote = internalMutation({
  args: {
    title: v.string(),
    body: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Ensure tags exist in tags table
    for (const tagName of args.tags) {
      const existingTag = await ctx.db
        .query("tags")
        .withIndex("by_name", (q) => q.eq("name", tagName))
        .first();
      
      if (!existingTag) {
        await ctx.db.insert("tags", {
          name: tagName,
          category: tagName.charAt(0).toUpperCase(),
        });
      }
    }
    
    const notes = await ctx.db.query("notes").collect();
    
    const newNoteId = await ctx.db.insert("notes", {
      title: args.title,
      body: args.body,
      color: '#A8D5BA', // Light green for AI-extracted notes
      tags: args.tags,
      createdAt: now,
      updatedAt: now,
      order: notes.length + 1,
      bullets: [],
      furtherQuestions: [],
      aiSummary: undefined,
      relatedNotes: [],
      links: [],
    });
    
    return { success: true, noteId: newNoteId, title: args.title };
  },
});

// Main action: Process daily notes using the agent + SEMANTIC SEARCH
export const processDailyNotes = action({
  args: {
    dailyContent: v.string(),
    dailyTasks: v.array(v.object({
      text: v.string(),
      completed: v.boolean(),
    })),
  },
  handler: async (ctx, args): Promise<{
    processed: boolean;
    summary: string;
    actions: Array<{
      type: 'append' | 'create';
      title?: string;
      noteId?: string;
      semanticScore?: number;
    }>;
  }> => {
    const { dailyContent, dailyTasks } = args;
    
    // Combine all content
    const tasksText = dailyTasks.length > 0
      ? `Tasks:\n${dailyTasks.map(t => `[${t.completed ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    const fullContent = tasksText + dailyContent;
    
    if (!fullContent.trim()) {
      return { 
        processed: false, 
        summary: "No content to process",
        actions: [] 
      };
    }
    
    // ============================================
    // STEP 1: Use LLM to EXTRACT valuable chunks
    // (LLM is good at understanding what's valuable)
    // ============================================
    
    const { threadId } = await dailyProcessor.createThread(ctx, {});
    
    const extractionResult = await dailyProcessor.generateText(ctx, { threadId }, {
      prompt: `DAILY NOTE TO PROCESS:
---
${fullContent}
---

EXTRACT valuable content worth preserving long-term. For each piece of valuable content, provide:
- The exact text to extract
- A suggested title (if it were to become its own note)
- Suggested tags (lowercase, single word)

Skip casual/temporary content (weather, meals, small talk).

OUTPUT JSON:
{
  "valuableChunks": [
    {
      "content": "exact valuable text to extract",
      "suggestedTitle": "Descriptive Title For This Content",
      "suggestedTags": ["tag1", "tag2"]
    }
  ],
  "summary": "One sentence: what valuable content was found today"
}

RULES:
- Only include content worth preserving LONG-TERM
- Extract the EXACT text, don't paraphrase
- Titles should be specific and descriptive
- Tags: lowercase, single word, descriptive
- Empty array is fine if nothing valuable
- Be SELECTIVE - quality over quantity`,
    });
    
    // Parse the LLM's extraction response
    let parsed: {
      valuableChunks: Array<{
        content: string;
        suggestedTitle: string;
        suggestedTags: string[];
      }>;
      summary: string;
    };
    
    try {
      const jsonMatch = extractionResult.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in LLM response");
      }
    } catch (e) {
      console.error("Failed to parse LLM extraction response:", e);
      return { 
        processed: false, 
        summary: "Failed to extract content",
        actions: [] 
      };
    }
    
    if (!parsed.valuableChunks || parsed.valuableChunks.length === 0) {
      return {
        processed: true,
        summary: parsed.summary || "No valuable content found to extract",
        actions: [],
      };
    }
    
    console.log(`LLM extracted ${parsed.valuableChunks.length} valuable chunks`);
    
    // ============================================
    // STEP 2: Use SEMANTIC SEARCH to find matches
    // (Vector similarity is better than LLM guessing)
    // ============================================
    
    const actions: Array<{
      type: 'append' | 'create';
      title?: string;
      noteId?: string;
      semanticScore?: number;
    }> = [];
    
    for (const chunk of parsed.valuableChunks) {
      console.log(`Processing chunk: "${chunk.content.substring(0, 50)}..."`);
      
      // Run semantic search to find the best matching existing note
      const semanticMatches = await ctx.runAction(api.embeddings.semanticSearch, {
        query: chunk.content,
        limit: 3, // Get top 3 matches
      });
      
      // Filter out daily/journey notes from matches (we don't want to append to those)
      const validMatches = semanticMatches.filter(
        (match: { tags: string[]; score: number }) => 
          !match.tags.includes('journey') && !match.tags.includes('daily')
      );
      
      const bestMatch = validMatches[0];
      
      if (bestMatch && bestMatch.score >= SEMANTIC_MATCH_THRESHOLD) {
        // ============================================
        // HIGH CONFIDENCE MATCH: Append to existing note
        // ============================================
        console.log(`  → Semantic match found: "${bestMatch.title}" (score: ${bestMatch.score.toFixed(3)})`);
        
        const result = await ctx.runMutation(internal.dailyProcessor.appendToExistingNote, {
          noteId: bestMatch._id,
          content: chunk.content,
        });
        
        actions.push({ 
          type: 'append', 
          title: result.noteTitle,
          noteId: bestMatch._id,
          semanticScore: bestMatch.score,
        });
      } else {
        // ============================================
        // NO GOOD MATCH: Create new note
        // ============================================
        const scoreInfo = bestMatch 
          ? `best match "${bestMatch.title}" scored ${bestMatch.score.toFixed(3)} < ${SEMANTIC_MATCH_THRESHOLD}` 
          : 'no matches found';
        console.log(`  → Creating new note (${scoreInfo})`);
        
        const result = await ctx.runMutation(internal.dailyProcessor.createExtractedNote, {
          title: chunk.suggestedTitle || "Extracted Insight",
          body: chunk.content,
          tags: chunk.suggestedTags || [],
        });
        
        actions.push({ 
          type: 'create', 
          title: result.title,
          noteId: result.noteId,
          semanticScore: bestMatch?.score,
        });
      }
    }
    
    // Build summary
    const appendCount = actions.filter(a => a.type === 'append').length;
    const createCount = actions.filter(a => a.type === 'create').length;
    const actionSummary = [];
    if (appendCount > 0) actionSummary.push(`${appendCount} appended to existing notes`);
    if (createCount > 0) actionSummary.push(`${createCount} new notes created`);
    
    return {
      processed: true,
      summary: `${parsed.summary}. ${actionSummary.join(', ') || 'No actions taken'}.`,
      actions,
    };
  },
});
