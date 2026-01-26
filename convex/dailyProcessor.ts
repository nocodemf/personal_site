import { Agent } from "@convex-dev/agent";
import { components, internal } from "./_generated/api";
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

// Daily Note Processor Agent
// Purpose: Analyze daily notes, extract important content, copy to appropriate notes
// Note: Original daily note stays intact - we're just copying valuable content out
export const dailyProcessor = new Agent(components.agent, {
  name: "dailyProcessor",
  languageModel: gateway("google/gemini-2.5-flash"),
  instructions: `You are a personal knowledge curator. Your job is to find valuable content in daily notes and copy it to the right place.

ROLE: Identify insights, ideas, learnings worth preserving. Copy them out.

BEHAVIOR:
- Find content worth keeping long-term (insights, decisions, learnings, ideas, reflections)
- Skip casual/temporary content - it stays in the daily note, that's fine
- When matching to existing notes, only match if DIRECTLY related to that note's topic
- New notes should have clear, specific titles
- Tags should be lowercase, single words, descriptive

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

// Main action: Process daily notes using the agent
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
    
    // Get existing notes for context
    const existingNotes = await ctx.runQuery(internal.dailyProcessor.getAllNotesContext, {});
    
    // Build context string
    const notesContext = existingNotes.length > 0
      ? existingNotes.map(n => 
          `[ID: ${n.id}] "${n.title}" - Tags: ${n.tags.join(', ')} - ${n.aiSummary || n.body.substring(0, 150)}`
        ).join('\n')
      : "No existing notes.";
    
    // Create a thread for the agent
    const { threadId } = await dailyProcessor.createThread(ctx, {});
    
    // First message: Provide context about existing notes
    await dailyProcessor.generateText(ctx, { threadId }, {
      prompt: `EXISTING NOTES IN MY KNOWLEDGE BASE:\n${notesContext}\n\nRemember these for matching.`,
    });
    
    // Second message: Analyze the daily content
    const analysisResult = await dailyProcessor.generateText(ctx, { threadId }, {
      prompt: `DAILY NOTE TO PROCESS:
---
${fullContent}
---

Find valuable content worth preserving long-term. For each valuable chunk, decide:
- Should it be APPENDED to an existing note? (use exact ID)
- Should it become a NEW note?

Skip casual/temporary content - it's fine staying in the daily note.

OUTPUT JSON:
{
  "valuableChunks": [
    {
      "content": "exact text to copy",
      "action": "append" | "create",
      "existingNoteId": "exact_id_if_append" | null,
      "newNoteTitle": "title_if_create" | null,
      "newNoteTags": ["tag1"] | []
    }
  ],
  "summary": "One sentence: what valuable content was extracted today"
}

RULES:
- Only include chunks worth preserving long-term
- Append only if chunk DIRECTLY relates to existing note's topic
- New note titles should be specific and descriptive
- Tags: lowercase, single word
- Empty array is fine if nothing valuable`,
    });
    
    // Parse the agent's response
    let parsed: {
      valuableChunks: Array<{
        content: string;
        action: string;
        existingNoteId: string | null;
        newNoteTitle: string | null;
        newNoteTags: string[];
      }>;
      summary: string;
    };
    
    try {
      const jsonMatch = analysisResult.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse agent response:", e);
      return { 
        processed: false, 
        summary: "Failed to analyze content",
        actions: [] 
      };
    }
    
    const actions: Array<{
      type: 'append' | 'create';
      title?: string;
      noteId?: string;
    }> = [];
    
    // Process each valuable chunk
    for (const chunk of parsed.valuableChunks || []) {
      if (chunk.action === 'append' && chunk.existingNoteId) {
        // Validate note exists
        const noteExists = existingNotes.some(n => n.id === chunk.existingNoteId);
        
        if (noteExists) {
          const result = await ctx.runMutation(internal.dailyProcessor.appendToExistingNote, {
            noteId: chunk.existingNoteId as Id<"notes">,
            content: chunk.content,
          });
          actions.push({ 
            type: 'append', 
            title: result.noteTitle,
            noteId: chunk.existingNoteId 
          });
        } else {
          // Fallback: create new note if ID invalid
          const result = await ctx.runMutation(internal.dailyProcessor.createExtractedNote, {
            title: chunk.newNoteTitle || "Extracted Insight",
            body: chunk.content,
            tags: chunk.newNoteTags || [],
          });
          actions.push({ 
            type: 'create', 
            title: result.title,
            noteId: result.noteId 
          });
        }
      } else if (chunk.action === 'create') {
        const result = await ctx.runMutation(internal.dailyProcessor.createExtractedNote, {
          title: chunk.newNoteTitle || "Extracted Insight",
          body: chunk.content,
          tags: chunk.newNoteTags || [],
        });
        actions.push({ 
          type: 'create', 
          title: result.title,
          noteId: result.noteId 
        });
      }
    }
    
    return {
      processed: true,
      summary: parsed.summary || (actions.length > 0 ? "Extracted valuable content" : "No valuable content found"),
      actions,
    };
  },
});
