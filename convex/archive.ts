import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all archive images
export const getImages = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let images;
    if (args.category) {
      images = await ctx.db
        .query("archiveImages")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
    } else {
      images = await ctx.db
        .query("archiveImages")
        .withIndex("by_uploadedAt")
        .order("desc")
        .collect();
    }
    
    // Get URLs for each image
    return await Promise.all(
      images.map(async (image) => ({
        ...image,
        url: await ctx.storage.getUrl(image.storageId),
      }))
    );
  },
});

// Generate upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Save image after upload
export const saveImage = mutation({
  args: {
    storageId: v.id("_storage"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("archiveImages", {
      storageId: args.storageId,
      title: args.title || undefined,
      description: args.description || undefined,
      category: args.category,
      uploadedAt: Date.now(),
      width: args.width,
      height: args.height,
    });
  },
});

// Delete image
export const deleteImage = mutation({
  args: { id: v.id("archiveImages") },
  handler: async (ctx, args) => {
    const image = await ctx.db.get(args.id);
    if (image) {
      await ctx.storage.delete(image.storageId);
      await ctx.db.delete(args.id);
    }
  },
});

