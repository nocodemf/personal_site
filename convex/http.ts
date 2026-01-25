import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// ============================================
// WhatsApp Bot HTTP Endpoints
// ============================================

// GET /api/context - Get context for the bot (recent notes, tags)
http.route({
  path: "/api/context",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const recentNotes = await ctx.runQuery(api.whatsappBot.getRecentNotes, {});
    const allTags = await ctx.runQuery(api.whatsappBot.getAllTags, {});
    
    return new Response(JSON.stringify({
      success: true,
      data: {
        recentNotes: recentNotes.map(n => ({
          id: n.id,
          title: n.title,
          tags: n.tags,
          preview: n.body.substring(0, 200),
          createdAt: n.createdAt,
        })),
        availableTags: allTags,
        totalNotes: recentNotes.length,
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/search - Search notes
http.route({
  path: "/api/search",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { query, limit } = body as { query: string; limit?: number };
    
    if (!query) {
      return new Response(JSON.stringify({ success: false, error: "Query required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const results = await ctx.runQuery(api.whatsappBot.searchNotes, { query, limit });
    
    return new Response(JSON.stringify({
      success: true,
      data: results,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/note - Create a new note
http.route({
  path: "/api/note",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { title, body: noteBody, tags, source } = body as {
      title: string;
      body: string;
      tags?: string[];
      source?: string;
    };
    
    if (!title || !noteBody) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Title and body required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const result = await ctx.runMutation(api.whatsappBot.createNoteFromWhatsApp, {
      title,
      body: noteBody,
      tags: tags || [],
      source,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// PATCH /api/note/:id - Append to existing note
http.route({
  path: "/api/note/append",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { noteId, content, addNewline } = body as {
      noteId: string;
      content: string;
      addNewline?: boolean;
    };
    
    if (!noteId || !content) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "noteId and content required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const result = await ctx.runMutation(api.whatsappBot.appendToNote, {
      noteId: noteId as any, // Cast to Id<"notes">
      content,
      addNewline,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/note/find-related - Find a related note for potential append
http.route({
  path: "/api/note/find-related",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { content, tags } = body as {
      content: string;
      tags?: string[];
    };
    
    if (!content) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Content required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const result = await ctx.runAction(api.whatsappBot.findRelatedNote, {
      content,
      tags,
    });
    
    return new Response(JSON.stringify({
      success: true,
      data: result,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// GET /api/note/:id - Get a specific note
http.route({
  path: "/api/note",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const noteId = url.searchParams.get("id");
    
    if (!noteId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Note ID required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const note = await ctx.runQuery(api.whatsappBot.getNoteById, {
      id: noteId as any,
    });
    
    if (!note) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Note not found" 
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({
      success: true,
      data: note,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/note/tags - Add tags to a note
http.route({
  path: "/api/note/tags",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { noteId, tags } = body as {
      noteId: string;
      tags: string[];
    };
    
    if (!noteId || !tags || tags.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "noteId and tags required" 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const result = await ctx.runMutation(api.whatsappBot.addTagsToNote, {
      noteId: noteId as any,
      tags,
    });
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// Handle CORS preflight
http.route({
  path: "/api/context",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/search",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/note",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/note/append",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/note/find-related",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/note/tags",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

export default http;

