import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Notes/Index items
  notes: defineTable({
    title: v.string(),
    body: v.string(),
    color: v.string(),
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    order: v.number(),
    // Legacy field (kept for backward compatibility)
    tasks: v.optional(v.array(v.object({
      text: v.string(),
      completed: v.boolean(),
    }))),
    // AI-generated sidebar fields
    bullets: v.optional(v.array(v.string())), // 3-5 key bullets extracted from content
    furtherQuestions: v.optional(v.array(v.string())), // Questions to deepen understanding
    aiSummary: v.optional(v.string()), // Summary of the note content
    relatedNotes: v.optional(v.array(v.id("notes"))), // Links to related notes (outgoing)
    links: v.optional(v.array(v.object({ // Extracted links from note
      url: v.string(),
      title: v.optional(v.string()),
    }))),
    // Track if AI analysis has been run
    lastAnalyzed: v.optional(v.number()),
    // Vector embeddings for semantic search
    embedding: v.optional(v.array(v.float64())), // 1536 dimensions for text-embedding-3-small
    embeddingUpdatedAt: v.optional(v.number()),
    // Knowledge graph: notes that link TO this note
    backlinks: v.optional(v.array(v.id("notes"))),
    // 2D position for heat map visualization (from UMAP)
    positionX: v.optional(v.float64()),
    positionY: v.optional(v.float64()),
    positionUpdatedAt: v.optional(v.number()),
  })
    .index("by_order", ["order"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  // Tags for filtering - aligned with left sidebar categories
  tags: defineTable({
    name: v.string(), // e.g., "ai", "architecture" (without #)
    category: v.string(), // letter category (A, B, C, etc.)
  }).index("by_category", ["category"])
    .index("by_name", ["name"]),

  // Site content - editable sections
  content: defineTable({
    section: v.string(), // "welcome", "about", etc.
    title: v.string(),
    body: v.string(),
    order: v.number(),
  }).index("by_section", ["section"]),

  // Navigation items
  navigation: defineTable({
    label: v.string(),
    href: v.string(),
    order: v.number(),
    isActive: v.boolean(),
  }).index("by_order", ["order"]),

  // Projects/ventures
  ventures: defineTable({
    title: v.string(),
    description: v.string(),
    imageUrl: v.optional(v.string()),
    link: v.optional(v.string()),
    category: v.string(), // "ventures", "travel", "food", "design"
    featured: v.boolean(),
    order: v.number(),
  }).index("by_category", ["category"]),

  // Archive images
  archiveImages: defineTable({
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    storageId: v.id("_storage"),
    category: v.string(),
    uploadedAt: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  }).index("by_category", ["category"])
    .index("by_uploadedAt", ["uploadedAt"]),

  // Contact messages
  messages: defineTable({
    name: v.string(),
    email: v.string(),
    message: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  }),

  // Daily notes (Today view) - stored server-side for scheduled processing
  dailyNotes: defineTable({
    date: v.string(), // "2026-01-27" format for the day
    notes: v.string(), // Free-form notes content
    tasks: v.array(v.object({
      text: v.string(),
      completed: v.boolean(),
    })),
    savedToIndex: v.boolean(), // Has this been saved as a permanent note?
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  // Passkey credentials for biometric authentication (single user)
  passkeys: defineTable({
    credentialId: v.string(), // Base64url-encoded credential ID
    publicKey: v.string(), // Base64url-encoded public key
    counter: v.number(), // Signature counter for replay attack prevention
    deviceName: v.string(), // e.g., "MacBook Pro", "iPhone 15"
    transports: v.optional(v.array(v.string())), // e.g., ["internal", "hybrid"]
    createdAt: v.number(),
  }).index("by_credentialId", ["credentialId"]),

  // Auth sessions for persistent login
  authSessions: defineTable({
    token: v.string(), // Random session token
    credentialId: v.string(), // Which passkey was used
    expiresAt: v.number(), // Expiration timestamp
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // Challenges for WebAuthn (temporary, cleaned up after use)
  authChallenges: defineTable({
    challenge: v.string(), // Base64url-encoded challenge
    type: v.string(), // "registration" or "authentication"
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_challenge", ["challenge"]),
});

