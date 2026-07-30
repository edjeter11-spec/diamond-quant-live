# Website-First Picks → Discord Auto-Post

**Status: BUILT (2026-07-30).** This started as a concept doc; the design
below was approved and implemented. Kept as the rationale/design record.

**What actually exists now:**

- `manual_picks` table — `supabase/migrations/009_manual_picks.sql`
  **⚠️ NOT YET APPLIED to production** — run it in the Supabase SQL Editor.
  Until then `/admin/picks` will error: the table genuinely isn't there.
- Admin UI — `app/admin/picks/page.tsx` (admin-gated, create/publish/retract/grade)
- API routes — `app/api/admin/picks/**`
- Bridge to the bot — `lib/bot/discord-bridge.ts`
- The bot itself — **`claude code/quant-picks-bot`** (NOT `discord-bot`, which
  is the unrelated Claude Code Discord bridge)
- Deployed on an Oracle Always Free VM at `129.153.157.160:8787`, running under
  systemd as `quant-bot`, auto-restarting and surviving reboots.

**Known gaps, stated plainly:**

- No RLS policy on `manual_picks`. Every other table in this schema has one.
  It's only reached through admin-gated service-role routes today, so it isn't
  exposed — but enable RLS when applying the migration.
- The bot API is plain HTTP, so the shared secret crosses the internet in the
  clear. Fine for now; put Caddy in front for TLS if this becomes load-bearing.

## The idea, in one paragraph

Right now picks and Discord posts are two separate things. The goal: make
the website the single place a pick is created, and have publishing it
there automatically post it to Discord with the same clickable sportsbook
buttons Discord users expect — so nobody ever posts a pick twice, and the
website and Discord always agree.

## Reality check first — what already exists vs. what's new

I looked through the current codebase before drafting this, because the
request describes a Discord bot that "automatically turns picks into
sportsbook links so users can click them, choose their sportsbook, and
place the bet." **That bot doesn't exist yet.** What's actually in the
codebase today:

- `lib/odds/sportsbooks.ts` — a one-way Discord **webhook** (`sendDiscordAlert`)
  that posts a plain embed (title/description/fields) for arb/EV alerts.
  No buttons, no slash commands, no bot process at all.
- `getDeepLink()` in the same file — real, working affiliate deep-links
  per sportsbook (DraftKings, FanDuel, etc.), already used to build
  clickable URLs elsewhere in the app. **This is the one piece that's
  genuinely reusable as-is** — it's exactly the link logic a Discord
  button would need.
- No concept anywhere of a human-authored pick (bet + units + confidence +
  write-up). Every pick in the system today is model-generated
  (`lib/bot/smart-picks.ts`, `lib/bot/prop-reasoning.ts`, etc.) and logged
  to `daily_picks_log` via `lib/bot/track-record.ts`'s `LoggedPick` type,
  which has no `writeup`/`author`/`units` fields.

So this isn't "wire two existing things together" — it's two real builds:
a pick-authoring flow on the website, and a Discord bot (with slash
commands or button interactions) that doesn't exist yet. Worth knowing
that going in, since it changes the honest size of this project.

## Proposed flow

1. **Author a pick on the website.** A new authenticated "Create Pick"
   form: sport, game, market, the actual bet, odds/book, units (stake
   size), a confidence label, and a write-up (the reasoning text).
2. **Save as draft.** Pick lives in a new table, status `draft` — visible
   only to the author (and maybe other admins) until published. This
   matters: it lets someone write a pick ahead of time without it leaking
   early.
3. **Publish.** Hitting Publish:
   - Flips the pick to `published` in the database (single source of truth).
   - Triggers a server-side call to the Discord bot, which posts an embed
     into the correct sport/channel — game, pick, units, confidence,
     write-up — with a row of buttons, one per sportsbook, each using the
     existing `getDeepLink()` affiliate URL for that book.
   - The website's own pick pages/feed read from the same `published` row
     — nothing about the website's display is a separate copy.
4. **Edits/grading later** (settlement, result, W/L) update the same row;
   whether that also edits the Discord message is a real design choice to
   make later (see open questions).

## What's genuinely reusable right now

- `getDeepLink()` + `DEEP_LINKS` — the sportsbook URL logic. A Discord
  button system should call this exact function, not reinvent affiliate
  links.
- `daily_picks_log` / `LoggedPick` conventions (sport, pick_date, category,
  odds, bookmaker, confidence) — a new `manual_picks` (or similar) table
  should follow the same naming/shape conventions already established,
  rather than inventing a parallel schema style.
- The existing honesty conventions from recent work — confidence labels,
  sample-size caveats, "not a real recommendation" banners — should extend
  to human-authored picks too. A human pick with big talk and no track
  record deserves the same care as a model pick with a thin sample.

## What's genuinely new work

1. **Pick authoring UI** — form, draft/publish states, edit-before-publish.
2. **A real Discord bot process** — not just a webhook. Needs its own
   hosting (a small always-on Node process, e.g. discord.js, per the
   "Discord Bot" project already on your project list at
   `claude code/discord-bot` — that folder doesn't exist yet either, so
   this could be its actual first real feature).
3. **Button interactions** — Discord's message components API (buttons
   tied to real URLs, which is straightforward — URL buttons need no bot
   logic to handle clicks, just the embed needs to be built with them).
4. **A server-to-bot bridge** — the website's Publish action needs to
   reach the bot (webhook call, shared API route, or a lightweight queue)
   so the post actually happens the moment someone clicks Publish.
5. **Channel routing** — mapping sport/pick-type to the correct Discord
   channel ID.

## Decisions (from Eddie, 2026-07-29)

- **Admin-only.** Only you can author/publish picks. Uses the same
  `isAdmin` gate already applied to Bot/QuantVerdict/Arbitrage — no new
  auth system needed, just add "Create Pick" to the existing admin-gated
  surface.
- **Edits after publish DO sync to Discord.** This means the bot needs to
  store the Discord `message_id` (+ `channel_id`) per pick when it first
  posts, so a later edit can call Discord's edit-message endpoint instead
  of posting a duplicate. This is the reason a real bot (not just a
  webhook) is required — webhooks can't reliably edit their own past
  messages without also storing the webhook message ID, which is doable
  but a bot token is more standard for this.
- **Grading/settlement DOES reflect back into the Discord post** (edit it
  green/red on W/L, same idea as the website's own status badges). Same
  mechanism as above — reuses the stored `message_id`.
- **Undo / draft-recall.** Since edits sync live, "Publish" is not meant
  to be irreversible. Add an **Unpublish / Retract** action: flips the
  pick back to `draft` in the DB and edits the Discord message to show a
  clearly marked "RETRACTED" state (strike the pick text, grey it out,
  keep it visible rather than deleting — deleting a message people may
  have already acted on is worse than marking it dead). A true delete
  option can exist too but should be separate from the everyday "I made a
  mistake, undo the publish" action.
- **Sportsbook buttons: DraftKings + FanDuel to start** — the two
  biggest/most-used books. Keep the button row logic generic (loop over a
  `book keys` list) so adding a third book later is a one-line change,
  not a rebuild.

## Updated proposed flow (incorporating undo + sync)

1. Create pick → saved `draft`.
2. Publish → DB row → `published`, bot posts embed w/ DK + FanDuel buttons,
   bot saves `discord_message_id` + `discord_channel_id` on the pick row.
3. Edit published pick (fix a typo, adjust units) → DB updates → bot edits
   the same Discord message via stored message_id. No duplicate post.
4. Retract/Unpublish → DB row → `draft` (or a new `retracted` status) →
   bot edits the Discord message to a visibly dead/struck-through state.
   Nothing is silently deleted from Discord.
5. Grade the pick (win/loss/push, via existing settlement flow) → bot
   edits the same message to show the result — color + result badge,
   consistent with how the website already marks graded picks.

## Suggested first slice, if/when this gets greenlit

Smallest real version that proves the concept, now including the
must-have sync/undo behavior (since that was a decided requirement, not
a nice-to-have):

1. New `manual_picks` table (status: draft / published / retracted,
   - `discord_message_id`, `discord_channel_id`) + admin-only authoring
     form on the website, reusing the existing `isAdmin` gate.
2. A real discord.js bot process (first real use of the empty
   `claude code/discord-bot` folder) that exposes a small internal API
   (or listens on a queue/webhook) for four actions: post, edit, retract,
   grade — all operating on a message_id it tracks itself.
3. Website Publish/Edit/Retract/Grade actions call that bot API.
4. Buttons: DraftKings + FanDuel only, via `getDeepLink()`, generic list
   so adding books later is trivial.

---

_This file is a planning artifact, not app code — safe to delete once the
concept has been reviewed/discussed. Nothing here has been implemented._
