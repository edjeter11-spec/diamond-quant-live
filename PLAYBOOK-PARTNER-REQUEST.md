# Playbook Partner / API Request

**Subject:** Existing Playbook user — API or supported URL scheme for programmatic QuickSlip links?

Hi Playbook team,

I run Quant Betting (https://diamond-quant-live.vercel.app), a sports betting analytics site with a Discord community of [X members]. We publish a daily "Parlay of the Day" (usually 3 MLB player-prop legs) plus a 5-pick player props board, generated automatically once per day.

We already use Playbook, and it works well. Pasting this into the playbookbot.com web interface:

> Bryce Harper Over 0.5 Hits, Keibert Ruiz Over 0.5 Hits, Ben Rice Over 0.5 Hits

correctly built a 3-leg parlay ($100 returns $311) with BetMGM, FanDuel, and Fanatics deep links. That's exactly the experience we want our members to have.

The only gap is that a human has to paste the picks into your site each day. We'd like to attach a pre-built betslip link to the automated Discord post instead. Volume is small and predictable: roughly 1-2 slip generations per day, one per sport. This is not a scraping operation and would not be high volume.

**What we're asking, in priority order:**

1. **Partner/affiliate API** — is there a supported endpoint for generating QuickSlip deeplinks from structured selections (player, market, line, side), or from plain text like the example above?
2. **Documented URL scheme** — if there's no API, is there a supported URL format we can build? We've noticed share links look like `playbookbot.com/books/{book}/passthrough?deeplinkId[0]=ML...&deeplinkId[1]=ML...`. Can those `deeplinkId` values be obtained through a supported endpoint, rather than reverse-engineered?
3. **Affiliate / revenue-share terms**, if a program applies to a partner of our size.

**Separate note — possible bug:** the @Playbook Discord bot does _not_ parse our MLB player props. The same text that the website handles correctly returns "please provide a valid betslip input" in Discord. Flagging in case it's useful to your team.

Happy to work within whatever rate limits or attribution requirements you'd want.

Thanks for your time,

[Your name]
Quant Betting — https://diamond-quant-live.vercel.app
[Your email]

---

## How to send

Submit this via the partner form at https://playbookbot.com/partner. Fill in the `[X members]`, name, and email placeholders first.
