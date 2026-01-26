import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

// Vercel AI Gateway client
const gateway = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
});

// Get all notes for context
export const getAllNotesContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    return notes.map(note => ({
      id: note._id,
      title: note.title,
      body: note.body.substring(0, 500), // Preview only
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
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return;
    
    const newBody = note.body + "\n\n---\n\n" + args.content;
    await ctx.db.patch(args.noteId, {
      body: newBody,
      updatedAt: Date.now(),
    });
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
    
    // Ensure tags exist
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
    
    await ctx.db.insert("notes", {
      title: args.title,
      body: args.body,
      color: '#A8D5BA', // Light green for extracted notes
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
  },
});

// Main action: Process daily notes at 11:30pm
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
    extracted: number;
    appended: number;
    created: number;
    discarded: number;
  }> => {
    const { dailyContent, dailyTasks } = args;
    
    // Combine content
    const tasksText = dailyTasks.length > 0
      ? `Tasks:\n${dailyTasks.map(t => `[${t.completed ? '✓' : ' '}] ${t.text}`).join('\n')}\n\n`
      : '';
    const fullContent = tasksText + dailyContent;
    
    if (!fullContent.trim()) {
      return { processed: false, extracted: 0, appended: 0, created: 0, discarded: 0 };
    }
    
    // Get all existing notes for context
    const existingNotes = await ctx.runQuery(internal.dailyProcessor.getAllNotesContext, {});
    
    // Build context about existing notes
    const notesContext = existingNotes
      .filter(n => !n.tags.includes('daily')) // Exclude other daily notes
      .map(n => `ID: ${n.id}\nTitle: "${n.title}"\nTags: ${n.tags.join(', ')}\nSummary: ${n.aiSummary || n.body.substring(0, 200)}`)
      .join('\n\n---\n\n');
    
    // Use AI to analyze the daily content
    const { text: responseText } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      prompt: `You are analyzing a daily note to extract important information.

DAILY NOTE CONTENT:
${fullContent}

EXISTING NOTES IN DATABASE:
${notesContext || "No existing notes yet."}

TASK: Analyze the daily note and categorize each meaningful chunk of content.

For each chunk, decide:
1. Is it IMPORTANT (insight, idea, learning, task, decision, plan) or SCRAP (casual chat, random thoughts, noise)?
2. If IMPORTANT: Does it relate strongly to an existing note? If yes, which one (by ID)? If no, it should be a new note.

OUTPUT JSON ONLY:
{
  "chunks": [
    {
      "content": "the actual text chunk",
      "type": "important" | "scrap",
      "action": "append" | "create" | "discard",
      "existingNoteId": "note_id_if_append" | null,
      "suggestedTitle": "title_if_create" | null,
      "suggestedTags": ["tag1", "tag2"] | []
    }
  ]
}

RULES:
- Be selective. Not everything is important.
- Only append if the chunk DIRECTLY relates to an existing note's topic.
- Create new notes for standalone insights, ideas, or learnings.
- Discard casual/throwaway content.
- Suggested tags should be lowercase, single words.
- Keep chunks atomic - one idea per chunk.

JSON ONLY. NO EXPLANATION.`,
      temperature: 0.3,
    });
    
    // Parse the AI response
    let parsed: {
      chunks: Array<{
        content: string;
        type: string;
        action: string;
        existingNoteId: string | null;
        suggestedTitle: string | null;
        suggestedTags: string[];
      }>;
    };
    
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", e);
      return { processed: false, extracted: 0, appended: 0, created: 0, discarded: 0 };
    }
    
    let appended = 0;
    let created = 0;
    let discarded = 0;
    
    // Process each chunk
    for (const chunk of parsed.chunks) {
      if (chunk.action === 'discard' || chunk.type === 'scrap') {
        discarded++;
        continue;
      }
      
      if (chunk.action === 'append' && chunk.existingNoteId) {
        // Validate the note ID exists
        const noteExists = existingNotes.some(n => n.id === chunk.existingNoteId);
        if (noteExists) {
          await ctx.runMutation(internal.dailyProcessor.appendToExistingNote, {
            noteId: chunk.existingNoteId as Id<"notes">,
            content: chunk.content,
          });
          appended++;
        } else {
          // Fallback to creating a new note if ID is invalid
          await ctx.runMutation(internal.dailyProcessor.createExtractedNote, {
            title: chunk.suggestedTitle || "Extracted Note",
            body: chunk.content,
            tags: chunk.suggestedTags || [],
          });
          created++;
        }
      } else if (chunk.action === 'create') {
        await ctx.runMutation(internal.dailyProcessor.createExtractedNote, {
          title: chunk.suggestedTitle || "Extracted Note",
          body: chunk.content,
          tags: chunk.suggestedTags || [],
        });
        created++;
      }
    }
    
    return {
      processed: true,
      extracted: parsed.chunks.filter(c => c.type === 'important').length,
      appended,
      created,
      discarded,
    };
  },
});

