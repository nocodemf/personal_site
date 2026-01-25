import { mutation } from "./_generated/server";

// Seed the database with placeholder notes and tags
export const seedDatabase = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if already seeded
    const existingNotes = await ctx.db.query("notes").first();
    if (existingNotes) {
      return { message: "Database already seeded" };
    }

    // Seed tags - aligned with left sidebar categories
    const tagData = [
      // A
      { name: "ai", category: "A" },
      { name: "architecture", category: "A" },
      { name: "art", category: "A" },
      { name: "automation", category: "A" },
      // B
      { name: "backend", category: "B" },
      { name: "books", category: "B" },
      { name: "business", category: "B" },
      // C
      { name: "code", category: "C" },
      { name: "creativity", category: "C" },
      { name: "crypto", category: "C" },
      // D
      { name: "data", category: "D" },
      { name: "design", category: "D" },
      { name: "devops", category: "D" },
      // E
      { name: "economics", category: "E" },
      { name: "engineering", category: "E" },
      { name: "experiments", category: "E" },
      // F
      { name: "finance", category: "F" },
      { name: "frontend", category: "F" },
      { name: "future", category: "F" },
      // L
      { name: "learning", category: "L" },
      { name: "life", category: "L" },
      { name: "links", category: "L" },
      // M
      { name: "marketing", category: "M" },
      { name: "music", category: "M" },
      { name: "mental-models", category: "M" },
      // N
      { name: "notes", category: "N" },
      { name: "networks", category: "N" },
      // P
      { name: "philosophy", category: "P" },
      { name: "productivity", category: "P" },
      { name: "projects", category: "P" },
      // S
      { name: "startups", category: "S" },
      { name: "systems", category: "S" },
      { name: "strategy", category: "S" },
      // T
      { name: "tech", category: "T" },
      { name: "thinking", category: "T" },
      { name: "tools", category: "T" },
      // W
      { name: "writing", category: "W" },
      { name: "work", category: "W" },
      { name: "web", category: "W" },
    ];

    for (const tag of tagData) {
      await ctx.db.insert("tags", tag);
    }

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    // Seed notes with tags that match our tag system
    const notesData = [
      {
        title: "AI Agent Architecture",
        body: "Exploring different architectural patterns for building autonomous AI agents. Key considerations include memory systems, tool use, and planning capabilities.",
        color: "#4A7CFF",
        tags: ["ai", "architecture", "systems"],
        createdAt: now - 2 * hour,
        updatedAt: now - 2 * hour,
        order: 1,
        tasks: [
          { text: "Research ReAct pattern", completed: true },
          { text: "Implement basic agent loop", completed: false },
        ],
        furtherQuestions: [
          "How to handle long-term memory?",
          "What's the best approach for tool selection?",
        ],
        aiSummary: "This note covers AI agent architecture patterns including ReAct, tool use, and memory systems.",
        relatedNotes: [],
      },
      {
        title: "Frontend Performance",
        body: "Notes on optimizing React applications. Focus on bundle size, rendering performance, and caching strategies.",
        color: "#E85454",
        tags: ["frontend", "code", "web"],
        createdAt: now - 5 * hour,
        updatedAt: now - 5 * hour,
        order: 2,
        tasks: [
          { text: "Audit bundle with webpack-bundle-analyzer", completed: false },
        ],
        furtherQuestions: ["Is SSR worth the complexity?"],
        aiSummary: "Performance optimization strategies for React applications.",
        relatedNotes: [],
      },
      {
        title: "Startup Fundraising",
        body: "Key learnings from recent fundraising process. Important metrics, pitch deck structure, and investor relations.",
        color: "#B8B8B8",
        tags: ["startups", "business", "finance"],
        createdAt: now - 1 * day,
        updatedAt: now - 1 * day,
        order: 3,
        tasks: [],
        furtherQuestions: ["What's the ideal runway?"],
        aiSummary: "Fundraising insights including metrics and pitch strategies.",
        relatedNotes: [],
      },
      {
        title: "Design Systems",
        body: "Building scalable design systems. Component architecture, token management, and documentation best practices.",
        color: "#E8E854",
        tags: ["design", "frontend", "systems"],
        createdAt: now - 2 * day,
        updatedAt: now - 2 * day,
        order: 4,
        tasks: [
          { text: "Define color tokens", completed: true },
          { text: "Create button variants", completed: true },
          { text: "Document usage guidelines", completed: false },
        ],
        furtherQuestions: [],
        aiSummary: "Guide to building and maintaining design systems.",
        relatedNotes: [],
      },
      {
        title: "Productivity Systems",
        body: "Personal productivity frameworks. GTD, time blocking, and digital organization tools.",
        color: "#E8A854",
        tags: ["productivity", "tools", "life"],
        createdAt: now - 3 * day,
        updatedAt: now - 3 * day,
        order: 5,
        tasks: [],
        furtherQuestions: ["How to maintain consistency?"],
        aiSummary: "Overview of productivity methodologies and tools.",
        relatedNotes: [],
      },
      {
        title: "Crypto Research",
        body: "Deep dive into blockchain consensus mechanisms. Proof of stake vs proof of work analysis.",
        color: "#2A2A2A",
        tags: ["crypto", "tech", "economics"],
        createdAt: now - 5 * day,
        updatedAt: now - 5 * day,
        order: 6,
        tasks: [],
        furtherQuestions: [
          "What are the security tradeoffs?",
          "How does slashing work?",
        ],
        aiSummary: "Analysis of blockchain consensus mechanisms.",
        relatedNotes: [],
      },
      {
        title: "Writing Practice",
        body: "Daily writing exercises and reflections. Building a consistent writing habit.",
        color: "#1A1A1A",
        tags: ["writing", "creativity", "learning"],
        createdAt: now - 7 * day,
        updatedAt: now - 7 * day,
        order: 7,
        tasks: [
          { text: "Write 500 words daily", completed: false },
        ],
        furtherQuestions: [],
        aiSummary: "Notes on developing a writing practice.",
        relatedNotes: [],
      },
      {
        title: "Mental Models",
        body: "Collection of useful mental models for decision making. First principles, inversion, and second-order thinking.",
        color: "#E8A8A8",
        tags: ["mental-models", "thinking", "philosophy"],
        createdAt: now - 14 * day,
        updatedAt: now - 14 * day,
        order: 8,
        tasks: [],
        furtherQuestions: ["How to apply these in practice?"],
        aiSummary: "Curated mental models for better decision making.",
        relatedNotes: [],
      },
    ];

    for (const note of notesData) {
      await ctx.db.insert("notes", note);
    }

    return { message: "Database seeded successfully" };
  },
});

