import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Delete a note
export const deleteNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// Clear all notes (for fresh start)
export const clearAllNotes = mutation({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }
    return { deleted: notes.length };
  },
});

// Clear all data (notes, tags, archive images) for complete fresh start
export const clearAllData = mutation({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    const tags = await ctx.db.query("tags").collect();
    const images = await ctx.db.query("archiveImages").collect();
    
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }
    for (const tag of tags) {
      await ctx.db.delete(tag._id);
    }
    for (const image of images) {
      await ctx.db.delete(image._id);
    }
    
    return { 
      deletedNotes: notes.length,
      deletedTags: tags.length,
      deletedImages: images.length 
    };
  },
});

// Update note content
export const updateNote = mutation({
  args: {
    id: v.id("notes"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: { title?: string; body?: string; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.title !== undefined) updates.title = args.title;
    if (args.body !== undefined) updates.body = args.body;
    
    await ctx.db.patch(args.id, updates);
  },
});

// Seed better content for existing notes
export const seedBetterContent = mutation({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query("notes").collect();
    
    const contentMap: Record<string, { title: string; body: string }> = {
      "AI Agent Architecture": {
        title: "AI Agent Architecture",
        body: `Been diving deep into how to build autonomous AI agents that actually work. Here's what I've learned so far:

The core loop is surprisingly simple: perceive → think → act → repeat. But the devil's in the details.

**Memory Systems**
This is where most agents fall apart. You need:
- Short-term memory (current conversation context)
- Long-term memory (persistent knowledge, usually vector DB)
- Working memory (scratch space for reasoning)

I've been experimenting with a hybrid approach - using Convex for structured data and Pinecone for semantic search. The key insight is that you need BOTH exact recall and fuzzy matching.

**Tool Use**
ReAct pattern seems to be the winner here. The agent reasons about what tool to use, uses it, observes the result, then reasons again. Simple but effective.

Tools I'm building:
- Web search (via Perplexity API)
- Code execution (sandboxed)
- File read/write
- Calendar/scheduling

**Planning**
This is the hardest part. How do you get an agent to break down a complex task into subtasks? 

Current approach: ask the LLM to generate a plan, then execute each step. But this falls apart for anything truly complex. Looking into tree-of-thought and Monte Carlo tree search for better planning.

Next steps: build a prototype that can actually complete a multi-step research task end-to-end.`
      },
      "Frontend Performance": {
        title: "Frontend Performance",
        body: `Notes from optimizing the main app. We were hitting 4+ second load times on mobile. Got it down to under 1 second.

**Bundle Size Wins**
- Switched from moment.js to date-fns (saved 200kb)
- Lazy loaded all routes with React.lazy()
- Replaced lodash with individual imports
- Used Bundlephobia to audit every new dependency

**Rendering Performance**
The React Profiler is your best friend. Found several components re-rendering on every keystroke.

Fixes:
- Wrapped expensive components in React.memo
- Used useMemo for filtered/sorted lists
- Moved state down (closer to where it's used)
- useCallback for event handlers passed as props

**Images**
This was the biggest win. We were serving full-res images to mobile.
- Implemented responsive images with srcset
- Added blur placeholders (like Next.js does)
- Lazy loaded below-fold images
- Converted everything to WebP

**Caching Strategy**
- Service worker for offline support
- Aggressive cache headers for static assets
- SWR for API data (stale-while-revalidate)

Still TODO: implement virtualization for the long lists. react-window looks promising.`
      },
      "Startup Fundraising": {
        title: "Startup Fundraising",
        body: `Just closed our seed round. Writing this down while it's fresh.

**What Actually Mattered**
1. Traction > everything. Our 40% MoM growth did all the talking.
2. Warm intros only. Cold emails had 0% response rate.
3. FOMO is real. Once we had one term sheet, three more appeared.

**The Pitch**
Kept it to 10 slides:
- Problem (with customer quotes)
- Solution (demo video)
- Market size (bottom-up TAM)
- Traction (the hockey stick)
- Business model
- Competition (honest assessment)
- Team (why us)
- The ask

**Metrics They Asked About**
- MRR and growth rate
- CAC and LTV (we didn't have enough data, they were ok with it)
- Churn (monthly and logo)
- NPS score
- Runway

**What I'd Do Differently**
- Start building investor relationships 6 months before raising
- Have a target list of 50 investors, ranked by fit
- Create a "warm intro" spreadsheet tracking who knows who
- Practice the pitch 20+ times before real meetings

**Terms We Negotiated**
- Pro-rata rights (gave to lead only)
- Board seat (gave one, kept two for founders)
- Option pool (15%, standard)

Total time from first meeting to wire: 8 weeks. Felt like 8 months.`
      },
      "Design Systems": {
        title: "Design Systems",
        body: `Building our design system from scratch. Documenting the process and decisions.

**Core Principles**
1. Consistency over creativity (for components)
2. Composition over configuration
3. Accessible by default
4. Dark mode from day one

**Token Architecture**
Three levels:
- Primitive tokens (raw values: colors, spacing, etc.)
- Semantic tokens (purpose-based: background-primary, text-muted)
- Component tokens (button-background, card-border)

Using CSS custom properties so tokens can be swapped at runtime for theming.

**Component Hierarchy**
Atoms → Molecules → Organisms → Templates → Pages

Started with:
- Button (primary, secondary, ghost, danger)
- Input (text, password, search)
- Card (basic, interactive, elevated)
- Modal (centered, slide-over)

**Documentation**
Using Storybook with:
- Component playground
- Props table (auto-generated)
- Usage guidelines
- Do's and don'ts with visual examples
- Accessibility notes

**Lessons Learned**
- Start with the most-used components
- Get design and eng aligned on naming early
- Version your tokens (breaking changes happen)
- Write migration guides when APIs change

Still need to figure out: how to handle one-off marketing components that don't fit the system.`
      },
      "Productivity Systems": {
        title: "Productivity Systems",
        body: `Tried a bunch of productivity systems. Here's what actually stuck.

**Morning Routine**
- Wake up at 6:30 (no snooze, phone across room)
- 20 min meditation (Headspace)
- Review daily priorities (max 3 things)
- Deep work block until noon (no meetings, no Slack)

**Task Management**
Settled on a hybrid system:
- Todoist for capture (quick add is clutch)
- Weekly review in Notion (plan the week)
- Daily MIT (Most Important Task) on paper

The paper part is key. Something about writing it physically makes it real.

**Time Blocking**
Calendar is the source of truth. If it's not on the calendar, it doesn't happen.

Blocks:
- Deep work (green) - no interruptions
- Meetings (red) - batched to afternoons
- Admin (yellow) - email, Slack, etc.
- Personal (blue) - gym, family, etc.

**Energy Management**
More important than time management. Track your energy:
- High energy → creative work, writing, coding
- Medium energy → meetings, collaboration
- Low energy → admin, email, routine tasks

**What Didn't Work**
- Pomodoro (too rigid)
- GTD full system (too complex)
- Zero inbox (not worth the effort)
- No meetings days (team needs sync time)

Current focus: reducing context switching. The research says it takes 23 minutes to get back to deep focus. Brutal.`
      },
      "Crypto Research": {
        title: "Crypto Research",
        body: `Deep dive into consensus mechanisms. Need to understand this for the wallet project.

**Proof of Work (PoW)**
How Bitcoin does it. Miners compete to solve hash puzzles.

Pros:
- Battle-tested (15+ years)
- Simple to understand
- Permissionless

Cons:
- Energy intensive (valid criticism)
- Mining centralization (ASIC farms)
- Slow finality

**Proof of Stake (PoS)**
How Ethereum does it now. Validators stake ETH as collateral.

Pros:
- 99%+ more energy efficient
- Faster finality
- No specialized hardware needed

Cons:
- "Rich get richer" criticism
- Slashing complexity
- Nothing-at-stake problem (mostly solved)

**The Slashing Question**
If a validator misbehaves (double signing, going offline), they lose staked ETH.

Types:
- Attestation violation: ~1 ETH
- Proposer violation: ~1 ETH  
- Correlation penalty: up to full stake (if many validators fail together)

This is actually clever - incentivizes running independent setups, not all on AWS.

**Other Mechanisms**
- Delegated PoS (Solana, Cosmos) - faster but more centralized
- Proof of History (Solana) - not really consensus, more like a clock
- DAG-based (IOTA, Fantom) - interesting but less proven

**My Take**
For our use case (institutional custody), we probably want PoS chains. Better sustainability story for ESG requirements.

Need to research: liquid staking derivatives (Lido, Rocket Pool). How do the risks compare?`
      },
      "Writing Practice": {
        title: "Writing Practice",
        body: `Committing to a daily writing practice. Documenting what works.

**The Habit**
500 words minimum, every morning, before checking anything.

Not editing, not publishing, just writing. The goal is volume and consistency.

**Prompts That Work**
When I'm stuck:
- "What's on my mind right now?"
- "What did I learn yesterday?"
- "What would I tell my past self about X?"
- "Why do I believe Y?"

**What I've Noticed**
Week 1-2: Painful. Every sentence feels wrong.
Week 3-4: Getting easier. Words flow more naturally.
Week 5+: Actually enjoying it. Ideas connect in unexpected ways.

**The Compound Effect**
Writing clarifies thinking. The more I write, the clearer my thoughts become. It's like the act of externalizing forces precision.

Had three business insights this month that came directly from morning writing sessions. ROI is real.

**Tools**
- iA Writer for drafts (minimal, focused)
- Notion for organization
- Grammarly for editing (when publishing)

**Reading → Writing Pipeline**
Best writing comes from synthesizing what I read.

Process:
1. Highlight while reading (Kindle, Readwise)
2. Review highlights weekly
3. Pick one idea to expand on
4. Write my take, not a summary

**Goal for Next Month**
Start publishing weekly. The writing is useless if no one reads it. Accountability + feedback = faster improvement.

Ship it scared.`
      },
      "Mental Models": {
        title: "Mental Models",
        body: `Collecting mental models that actually change how I think.

**First Principles Thinking**
Break problems down to fundamental truths, then reason up from there.

Elon's classic: "Batteries are expensive" → Why? → Materials + manufacturing + margin → Actually, raw materials are cheap → Build your own factory.

I use this when stuck on "that's just how it's done" problems.

**Inversion**
Instead of asking "How do I succeed?", ask "How would I guarantee failure?" Then don't do those things.

Example: How to fail at a startup?
- Don't talk to customers
- Build in isolation
- Hire fast, fire slow
- Ignore unit economics

Now I have a checklist of what NOT to do.

**Second-Order Thinking**
First-order: What happens if I do X?
Second-order: And then what happens?

Most people stop at first-order. The edge is in thinking further.

Example: "Let's add this feature"
First-order: Users get new capability
Second-order: Support tickets increase, complexity grows, new engineers confused, velocity drops

**The Map Is Not The Territory**
Models are useful but incomplete. Don't confuse your mental model of reality with reality itself.

Keeps me humble. My understanding of any system is always partial.

**Hanlon's Razor**
"Never attribute to malice that which can be explained by ignorance."

Saves me from paranoid thinking. When someone does something that seems hostile, they're probably just uninformed or careless.

**Opportunity Cost**
Every yes is a no to something else. What am I NOT doing by doing this?

This one is underrated. Most people don't think about what they're giving up.

**Circle of Competence**
Know what you know. More importantly, know what you don't know.

Stay inside your circle for decisions. Step outside only to learn.`
      },
    };

    for (const note of notes) {
      const content = contentMap[note.title];
      if (content && note.body !== content.body) {
        await ctx.db.patch(note._id, {
          body: content.body,
          updatedAt: Date.now(),
        });
      }
    }

    return { updated: Object.keys(contentMap).length };
  },
});

