import { v } from "convex/values";
import { mutation, query, action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";

// Configuration for WebAuthn
const RP_NAME = "Urav's Site";
// Use environment variables for domain configuration
// Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN in Convex dashboard for production
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";

// Session duration: 7 days
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Challenge expiration: 5 minutes
const CHALLENGE_EXPIRATION_MS = 5 * 60 * 1000;

// Helper to generate random tokens
function generateRandomToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Public Queries
// ============================================

// Check if any passkeys are registered
export const hasPasskeys = query({
  args: {},
  handler: async (ctx) => {
    const passkeys = await ctx.db.query("passkeys").first();
    return passkeys !== null;
  },
});

// Get all registered devices (for settings/management)
export const getRegisteredDevices = query({
  args: {},
  handler: async (ctx) => {
    const passkeys = await ctx.db.query("passkeys").collect();
    return passkeys.map((p: { _id: string; deviceName: string; createdAt: number }) => ({
      id: p._id,
      deviceName: p.deviceName,
      createdAt: p.createdAt,
    }));
  },
});

// Validate a session token
export const validateSession = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    
    if (!session) return { valid: false };
    if (session.expiresAt < Date.now()) return { valid: false };
    
    return { valid: true };
  },
});

// ============================================
// Internal Queries (for actions to call)
// ============================================

export const getAllPasskeysInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("passkeys").collect();
  },
});

export const getPasskeyByCredentialIdInternal = internalQuery({
  args: { credentialId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("passkeys")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", args.credentialId))
      .first();
  },
});

// ============================================
// Internal Mutations (for actions to call)
// ============================================

// Store a new passkey credential
export const storePasskeyInternal = internalMutation({
  args: {
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
    deviceName: v.string(),
    transports: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("passkeys", {
      credentialId: args.credentialId,
      publicKey: args.publicKey,
      counter: args.counter,
      deviceName: args.deviceName,
      transports: args.transports,
      createdAt: Date.now(),
    });
  },
});

// Update passkey counter after successful authentication
export const updatePasskeyCounterInternal = internalMutation({
  args: {
    credentialId: v.string(),
    newCounter: v.number(),
  },
  handler: async (ctx, args) => {
    const passkey = await ctx.db
      .query("passkeys")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", args.credentialId))
      .first();
    
    if (passkey) {
      await ctx.db.patch(passkey._id, { counter: args.newCounter });
    }
  },
});

// Store a challenge
export const storeChallengeInternal = internalMutation({
  args: {
    challenge: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    // Clean up expired challenges first
    const expiredChallenges = await ctx.db
      .query("authChallenges")
      .collect();
    
    for (const ch of expiredChallenges) {
      if (ch.expiresAt < Date.now()) {
        await ctx.db.delete(ch._id);
      }
    }
    
    return await ctx.db.insert("authChallenges", {
      challenge: args.challenge,
      type: args.type,
      expiresAt: Date.now() + CHALLENGE_EXPIRATION_MS,
      createdAt: Date.now(),
    });
  },
});

// Verify and consume a challenge
export const consumeChallengeInternal = internalMutation({
  args: {
    challenge: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const challengeDoc = await ctx.db
      .query("authChallenges")
      .withIndex("by_challenge", (q) => q.eq("challenge", args.challenge))
      .first();
    
    if (!challengeDoc) return { valid: false };
    if (challengeDoc.type !== args.type) return { valid: false };
    if (challengeDoc.expiresAt < Date.now()) {
      await ctx.db.delete(challengeDoc._id);
      return { valid: false };
    }
    
    // Consume the challenge (one-time use)
    await ctx.db.delete(challengeDoc._id);
    return { valid: true };
  },
});

// Create a new session
export const createSessionInternal = internalMutation({
  args: {
    credentialId: v.string(),
  },
  handler: async (ctx, args): Promise<{ token: string; expiresAt: number }> => {
    const token = generateRandomToken();
    
    await ctx.db.insert("authSessions", {
      token,
      credentialId: args.credentialId,
      expiresAt: Date.now() + SESSION_DURATION_MS,
      createdAt: Date.now(),
    });
    
    return { token, expiresAt: Date.now() + SESSION_DURATION_MS };
  },
});

// ============================================
// Public Mutations
// ============================================

// Delete a session (logout)
export const deleteSession = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    
    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

// Remove a registered device
export const removeDevice = mutation({
  args: { deviceId: v.id("passkeys") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.deviceId);
  },
});

// ============================================
// Actions for WebAuthn operations
// ============================================

// Generate registration options for a new device
export const getRegistrationOptions = action({
  args: { deviceName: v.string() },
  handler: async (ctx, args) => {
    // Get existing passkeys to exclude
    const existingPasskeys = await ctx.runQuery(internal.passkey.getAllPasskeysInternal, {});
    
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: "urav", // Single user
      userDisplayName: "Urav",
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((p: { credentialId: string; transports?: string[] }) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[] | undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
        authenticatorAttachment: "platform", // Only platform authenticators (TouchID, FaceID)
      },
    });
    
    // Store the challenge
    await ctx.runMutation(internal.passkey.storeChallengeInternal, {
      challenge: options.challenge,
      type: "registration",
    });
    
    return { options, deviceName: args.deviceName };
  },
});

// Verify registration and store the credential
export const verifyRegistration = action({
  args: {
    response: v.any(), // RegistrationResponseJSON
    deviceName: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; sessionToken?: string; error?: string }> => {
    const response = args.response as RegistrationResponseJSON;
    
    // Verify the challenge was valid
    const challengeResult = await ctx.runMutation(internal.passkey.consumeChallengeInternal, {
      challenge: response.response.clientDataJSON 
        ? JSON.parse(atob(response.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'))).challenge
        : "",
      type: "registration",
    });
    
    if (!challengeResult.valid) {
      return { success: false, error: "Invalid or expired challenge" };
    }
    
    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: () => true, // We already validated via consumeChallenge
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
      
      if (!verification.verified || !verification.registrationInfo) {
        return { success: false, error: "Verification failed" };
      }
      
      const { credential } = verification.registrationInfo;
      
      // Store the credential
      await ctx.runMutation(internal.passkey.storePasskeyInternal, {
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        deviceName: args.deviceName,
        transports: response.response.transports,
      });
      
      // Create a session for immediate login
      const sessionResult = await ctx.runMutation(internal.passkey.createSessionInternal, {
        credentialId: credential.id,
      });
      
      return { success: true, sessionToken: sessionResult.token };
    } catch (error) {
      console.error("Registration verification error:", error);
      return { success: false, error: "Verification failed" };
    }
  },
});

// Generate authentication options
export const getAuthenticationOptions = action({
  args: {},
  handler: async (ctx) => {
    // Get existing passkeys
    const passkeys = await ctx.runQuery(internal.passkey.getAllPasskeysInternal, {});
    
    if (passkeys.length === 0) {
      return { error: "No registered devices" };
    }
    
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: passkeys.map((p: { credentialId: string; transports?: string[] }) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransport[] | undefined,
      })),
      userVerification: "required",
    });
    
    // Store the challenge
    await ctx.runMutation(internal.passkey.storeChallengeInternal, {
      challenge: options.challenge,
      type: "authentication",
    });
    
    return { options };
  },
});

// Verify authentication
export const verifyAuthentication = action({
  args: {
    response: v.any(), // AuthenticationResponseJSON
  },
  handler: async (ctx, args): Promise<{ success: boolean; sessionToken?: string; error?: string }> => {
    const response = args.response as AuthenticationResponseJSON;
    
    // Get the passkey for this credential
    const passkeyData = await ctx.runQuery(internal.passkey.getPasskeyByCredentialIdInternal, {
      credentialId: response.id,
    });
    
    if (!passkeyData) {
      return { success: false, error: "Unknown credential" };
    }
    
    // Verify the challenge was valid
    const challengeResult = await ctx.runMutation(internal.passkey.consumeChallengeInternal, {
      challenge: response.response.clientDataJSON
        ? JSON.parse(atob(response.response.clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'))).challenge
        : "",
      type: "authentication",
    });
    
    if (!challengeResult.valid) {
      return { success: false, error: "Invalid or expired challenge" };
    }
    
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: () => true, // We already validated via consumeChallenge
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: passkeyData.credentialId,
          publicKey: Buffer.from(passkeyData.publicKey, "base64url"),
          counter: passkeyData.counter,
        },
      });
      
      if (!verification.verified) {
        return { success: false, error: "Verification failed" };
      }
      
      // Update the counter
      await ctx.runMutation(internal.passkey.updatePasskeyCounterInternal, {
        credentialId: passkeyData.credentialId,
        newCounter: verification.authenticationInfo.newCounter,
      });
      
      // Create a session
      const sessionResult = await ctx.runMutation(internal.passkey.createSessionInternal, {
        credentialId: passkeyData.credentialId,
      });
      
      return { success: true, sessionToken: sessionResult.token };
    } catch (error) {
      console.error("Authentication verification error:", error);
      return { success: false, error: "Verification failed" };
    }
  },
});
