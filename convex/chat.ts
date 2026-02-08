import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// Get all data needed for chat context
export const getChatContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all notes — limit to most recent 30 to keep context manageable
    const notes = await ctx.db.query("notes").order("desc").take(30);
    const notesContext = notes
      .map(
        (n) =>
          `• ${n.title} [${(n.tags ?? []).join(", ")}]${n.aiSummary ? ` — ${n.aiSummary}` : ""}\n  ${(n.body ?? "").substring(0, 150)}${(n.body ?? "").length > 150 ? "..." : ""}`
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
      ? `Notes: ${(todayNote.notes ?? "").substring(0, 500) || "(empty)"}\nAI Summary: ${todayNote.aiSummary || "(none)"}`
      : "No daily note yet.";

    return {
      notesContext: notesContext.substring(0, 6000), // Cap total context
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
    let context;
    try {
      context = await ctx.runQuery(internal.chat.getChatContext, {});
    } catch (err) {
      console.error("[chat] Failed to fetch context:", String(err));
      context = { notesContext: "", noteCount: 0, tasksContext: "", todayContext: "" };
    }

    const apiKey = process.env.VERCEL_AI_GATEWAY_API_KEY;
    if (!apiKey) {
      console.error("[chat] VERCEL_AI_GATEWAY_API_KEY is not set!");
      return "Chat is not configured — missing API key.";
    }

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

    // Only keep last 10 messages to avoid token overflow
    const recentMessages = args.messages.slice(-10);

    try {
      const response = await fetch(
        "https://ai-gateway.vercel.sh/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              ...recentMessages,
            ],
            max_tokens: 500,
            temperature: 0.7,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[chat] API error:", response.status, errorText.substring(0, 300));
        return `Sorry, couldn't get a response (${response.status}). Try again in a moment.`;
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content?.trim();

      if (!reply) {
        console.error("[chat] Empty reply from API. Response:", JSON.stringify(data).substring(0, 300));
        return "Got an empty response. Try rephrasing your question.";
      }

      return reply;
    } catch (err) {
      console.error("[chat] Fetch error:", String(err));
      return "Something went wrong connecting to the AI. Try again.";
    }
  },
});
