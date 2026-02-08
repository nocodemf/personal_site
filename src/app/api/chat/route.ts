import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const gateway = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.VERCEL_AI_GATEWAY_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Fetch all context from Convex in parallel
  const [notes, todayTasks, todayNote] = await Promise.all([
    convex.query(api.content.getNotes, {}).catch(() => []),
    convex.query(api.taskBank.getTodayTasks, {}).catch(() => []),
    convex.query(api.dailyNotes.getToday, {}).catch(() => null),
  ]);

  // Build notes context (title, tags, summary, body preview)
  const notesContext = (notes as Array<{
    title: string;
    tags: string[];
    aiSummary?: string;
    body: string;
  }>)
    .map(
      (n) =>
        `• ${n.title} [${n.tags.join(", ")}]${n.aiSummary ? ` — ${n.aiSummary}` : ""}\n  ${n.body.substring(0, 200)}${n.body.length > 200 ? "..." : ""}`
    )
    .join("\n");

  // Build tasks context
  const tasksContext = (todayTasks as Array<{
    text: string;
    status: string;
  }>)
    .map((t) => `[${t.status === "completed" ? "✓" : " "}] ${t.text}`)
    .join("\n");

  // Build today note context
  const todayContext = todayNote
    ? `Notes: ${(todayNote as { notes: string }).notes || "(empty)"}\nAI Summary: ${(todayNote as { aiSummary?: string }).aiSummary || "(none)"}`
    : "No daily note yet.";

  const systemPrompt = `You are a personal AI assistant embedded in the user's dashboard. You have full access to their knowledge base, tasks, and daily notes.

PERSONALITY:
- Concise, direct, no fluff. Match the user's tone — casual, smart, slightly punchy.
- Never be sycophantic. No "Great question!" or "I'd be happy to help!". Just answer.
- Use short paragraphs. Bullet points when listing. No walls of text.
- If you don't know something from their data, say so plainly.

CONTEXT — USER'S KNOWLEDGE BASE (${(notes as unknown[]).length} notes):
${notesContext || "(no notes yet)"}

TODAY'S TASKS:
${tasksContext || "(no tasks today)"}

TODAY'S NOTES:
${todayContext}

RULES:
- Reference specific notes, tasks, or topics when relevant.
- Keep responses under 150 words unless the user asks for detail.
- If asked about something in their notes, quote or reference the specific note.
- You can help brainstorm, summarise, connect ideas across notes, or just chat.`;

  const result = streamText({
    model: gateway("google/gemini-2.5-flash"),
    system: systemPrompt,
    messages,
  });

  return result.toTextStreamResponse();
}
