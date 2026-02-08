import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// Get all data needed for chat context
export const getChatContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all notes
    const notes = await ctx.db.query("notes").collect();
    const notesContext = notes
      .map(
        (n) =>
          `• ${n.title} [${n.tags.join(", ")}]${n.aiSummary ? ` — ${n.aiSummary}` : ""}\n  ${n.body.substring(0, 200)}${n.body.length > 200 ? "..." : ""}`
      )
      .join("\n");

    // Get today's tasks
    const today = new Date().toISOString().split("T")[0];
    const todayTasks = await ctx.db
      .query("taskBank")
      .withIndex("by_status_and_date", (q) =>
        q.eq("status", "active").eq("scheduledDate", today)
      )
      .collect();
    // Also include completed tasks for today
    const completedTasks = await ctx.db
      .query("taskBank")
      .withIndex("by_status_and_date", (q) =>
        q.eq("status", "completed").eq("scheduledDate", today)
      )
      .collect();
    const allTodayTasks = [...todayTasks, ...completedTasks];
    const tasksContext = allTodayTasks
      .map((t) => `[${t.status === "completed" ? "✓" : " "}] ${t.text}`)
      .join("\n");

    // Get today's daily note
    const todayNote = await ctx.db
      .query("dailyNotes")
      .withIndex("by_date", (q) => q.eq("date", today))
      .first();
    const todayContext = todayNote
      ? `Notes: ${todayNote.notes || "(empty)"}\nAI Summary: ${todayNote.aiSummary || "(none)"}`
      : "No daily note yet.";

    return {
      notesContext,
      noteCount: notes.length,
      tasksContext,
      todayContext,
    };
  },
});

// Chat action — called from the frontend
export const sendMessage = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<string> => {
    // Fetch context
    const context = await ctx.runQuery(internal.chat.getChatContext, {});

    const systemPrompt = `You are a personal AI assistant embedded in the user's dashboard. You have full access to their knowledge base, tasks, and daily notes.

PERSONALITY:
- Concise, direct, no fluff. Match the user's tone — casual, smart, slightly punchy.
- Never be sycophantic. No "Great question!" or "I'd be happy to help!". Just answer.
- Use short paragraphs. Bullet points when listing. No walls of text.
- If you don't know something from their data, say so plainly.

CONTEXT — USER'S KNOWLEDGE BASE (${context.noteCount} notes):
${context.notesContext || "(no notes yet)"}

TODAY'S TASKS:
${context.tasksContext || "(no tasks today)"}

TODAY'S NOTES:
${context.todayContext}

RULES:
- Reference specific notes, tasks, or topics when relevant.
- Keep responses under 150 words unless the user asks for detail.
- If asked about something in their notes, quote or reference the specific note.
- You can help brainstorm, summarise, connect ideas across notes, or just chat.`;

    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VERCEL_AI_GATEWAY_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            ...args.messages,
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Chat API error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      throw new Error("No response from AI");
    }

    return reply;
  },
});

