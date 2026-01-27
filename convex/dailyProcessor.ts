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
// Purpose: EXTRACT valuable content from daily notes (HIGHLY SELECTIVE)
// Note: Matching to existing notes is done via SEMANTIC SEARCH, not LLM guessing
export const dailyProcessor = new Agent(components.agent, {
  name: "dailyProcessor",
  languageModel: gateway("google/gemini-2.5-flash"),
  instructions: `You are a HIGHLY SELECTIVE knowledge curator. Most daily notes contain NOTHING worth extracting - and that's correct.

YOUR STANDARD IS HIGH:
- Only extract COMPLETE, FORMED thoughts - not rough notes or fragments
- A "maybe" or "I wonder" is NOT extractable
- A decision with reasoning IS extractable
- A vague intention is NOT extractable  
- A concrete system/framework IS extractable

DEFAULT TO NOT EXTRACTING. The daily note already preserves everything.
Only extract what DESERVES to live as permanent, standalone knowledge.

OUTPUT: Valid JSON only. Empty array is often the correct answer.`,
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
      type: 'append' | 'create' | 'skipped';
      title?: string;
      noteId?: string;
      semanticScore?: number;
      importance?: number;
      reason?: string;
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

You are a HIGHLY SELECTIVE knowledge curator. Your job is to find content that DESERVES to be preserved as permanent knowledge - not just any note or thought.

WHAT TO EXTRACT (importance 4-5):
✓ A concrete decision made with reasoning ("Decided to use PostgreSQL because...")
✓ A system/framework/mental model discovered ("The 3-step process for X is...")
✓ A hard-won insight or lesson learned ("After failing 3 times, I realized...")
✓ A breakthrough idea that's fully formed ("New product concept: A tool that...")
✓ Important information that will be referenced later ("API key for X is... / Meeting with Y scheduled for...")
✓ A principle or rule discovered ("Never do X without Y because...")

WHAT TO SKIP (importance 1-3):
✗ Rough thoughts still being formed ("Maybe I should try..." "Thinking about...")
✗ Questions without answers ("I wonder if..." "Need to figure out...")
✗ Vague intentions ("Want to explore X" "Should look into Y")
✗ Status updates ("Made progress on X" "Finished task Y")
✗ Feelings/moods ("Feeling tired" "Good day today")
✗ Casual observations ("Weather is nice" "Had coffee with...")
✗ Todo items or reminders ("Remember to..." "Don't forget...")

IMPORTANCE SCALE:
5 = CRITICAL: A decision, system, or insight I would deeply regret losing. Fully formed.
4 = VALUABLE: A learning or reference I'll want to find again. Complete thought.
3 = CONDITIONAL: Only useful if it directly extends an existing note topic.
1-2 = SKIP: Everything else stays in the daily note where it belongs.

OUTPUT JSON:
{
  "valuableChunks": [
    {
      "content": "exact text to extract (complete thought, not fragment)",
      "importance": 5,
      "suggestedTitle": "Specific Descriptive Title",
      "suggestedTags": ["tag1"],
      "reasoning": "why this deserves permanent preservation"
    }
  ],
  "summary": "One sentence summary"
}

CRITICAL RULES:
- MOST DAILY NOTES HAVE ZERO EXTRACTABLE CHUNKS. That's normal and correct.
- Empty array is the RIGHT answer if nothing is truly valuable
- If in doubt, DON'T extract - the daily note preserves everything anyway
- Only extract COMPLETE thoughts, not fragments or half-formed ideas
- A rough note is NOT the same as a valuable insight`,
    });
    
    // Parse the LLM's extraction response
    let parsed: {
      valuableChunks: Array<{
        content: string;
        importance: number;
        suggestedTitle: string;
        suggestedTags: string[];
        reasoning?: string;
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
    
    console.log(`LLM extracted ${parsed.valuableChunks.length} chunks`);
    
    // ============================================
    // STEP 2: Use SEMANTIC SEARCH to find matches
    // Decision logic based on importance:
    // - Importance 4-5: Keep (append to match OR create new note)
    // - Importance 3: Only keep if semantic match exists
    // ============================================
    
    const actions: Array<{
      type: 'append' | 'create' | 'skipped';
      title?: string;
      noteId?: string;
      semanticScore?: number;
      importance?: number;
      reason?: string;
    }> = [];
    
    for (const chunk of parsed.valuableChunks) {
      const importance = chunk.importance || 3;
      console.log(`Processing chunk (importance ${importance}): "${chunk.content.substring(0, 50)}..."`);
      
      // Run semantic search to find the best matching existing note
      const semanticMatches = await ctx.runAction(api.embeddings.semanticSearch, {
        query: chunk.content,
        limit: 3,
      });
      
      // Filter out daily/journey notes from matches
      const validMatches = semanticMatches.filter(
        (match: { tags: string[]; score: number }) => 
          !match.tags.includes('journey') && !match.tags.includes('daily')
      );
      
      const bestMatch = validMatches[0];
      const hasGoodMatch = bestMatch && bestMatch.score >= SEMANTIC_MATCH_THRESHOLD;
      
      if (hasGoodMatch) {
        // ============================================
        // SEMANTIC MATCH FOUND: Append to existing note
        // ============================================
        console.log(`  → Appending to "${bestMatch.title}" (score: ${bestMatch.score.toFixed(3)})`);
        
        const result = await ctx.runMutation(internal.dailyProcessor.appendToExistingNote, {
          noteId: bestMatch._id,
          content: chunk.content,
        });
        
        actions.push({ 
          type: 'append', 
          title: result.noteTitle,
          noteId: bestMatch._id,
          semanticScore: bestMatch.score,
          importance,
        });
      } else if (importance >= 4) {
        // ============================================
        // HIGH IMPORTANCE + NO MATCH: Create new note
        // Only importance 4-5 warrants a new note
        // ============================================
        const scoreInfo = bestMatch 
          ? `best match scored ${bestMatch.score.toFixed(3)}` 
          : 'no matches';
        console.log(`  → Creating new note (importance ${importance}, ${scoreInfo})`);
        
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
          importance,
        });
      } else {
        // ============================================
        // LOW IMPORTANCE + NO MATCH: Skip
        // Importance 3 without a match stays in daily note
        // ============================================
        const scoreInfo = bestMatch 
          ? `best match scored ${bestMatch.score.toFixed(3)}` 
          : 'no matches';
        console.log(`  → Skipping (importance ${importance} too low for new note, ${scoreInfo})`);
        
        actions.push({
          type: 'skipped',
          title: chunk.suggestedTitle,
          importance,
          semanticScore: bestMatch?.score,
          reason: `Importance ${importance} < 4, no semantic match`,
        });
      }
    }
    
    // Build summary
    const appendCount = actions.filter(a => a.type === 'append').length;
    const createCount = actions.filter(a => a.type === 'create').length;
    const skippedCount = actions.filter(a => a.type === 'skipped').length;
    const actionSummary = [];
    if (appendCount > 0) actionSummary.push(`${appendCount} appended`);
    if (createCount > 0) actionSummary.push(`${createCount} new notes`);
    if (skippedCount > 0) actionSummary.push(`${skippedCount} skipped (low importance)`);
    
    return {
      processed: true,
      summary: `${parsed.summary}. ${actionSummary.join(', ') || 'No actions taken'}.`,
      actions,
    };
  },
});
