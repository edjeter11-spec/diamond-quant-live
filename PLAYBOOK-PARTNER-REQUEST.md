# Playbook Partner / API Request

**Subject:** Existing Playbook user — API or supported URL scheme for programmatic QuickSlip links?

Hi Playbook team,

I run Quant Betting (https://diamond-quant-live.vercel.app), a sports betting analytics site with a Discord community of [X members]. We publish a daily "Parlay of the Day" (usually 3 MLB player-prop legs) plus a 5-pick player props board, generated automatically once per day.

We already use Playbook, and it works well. Pasting this into the playbookbot.com web interface:

> Bryce Harper Over 0.5 Hits, Keibert Ruiz Over 0.5 Hits, Ben Rice Over 0.5 Hits

correctly built a 3-leg parlay ($100 returns $311) with BetMGM, FanDuel, and Fanatics deep links. That's exactly the experience we want our members to have.

The only gap is that a human has to paste the picks into your site each day. We'd like to attach a pre-built betslip link to the automated Discord post instead. Volume is small and predictable: roughly 1-2 slip generations per day, one per sport. This is not a scraping operation and would not be high volume.

**What we're asking:**

1. **An API key of our own.** We can see that `POST https://playbook-api.actionnetwork.com/v1/search` already does exactly what we need — it accepts `user_message` as plain text and returns a `passthrough_url`. We are not asking you to build anything. We'd just like our own credential rather than using the one that ships in your homepage JavaScript, which we don't consider ours to use.
2. **Whatever terms come with it** — rate limits, attribution, required disclosure. Happy to work within any of it. Our volume is 1–2 calls per day.
3. **Affiliate / revenue-share**, if a program applies to a partner of our size.

**Separate note — possible bug:** the @Playbook Discord bot does _not_ parse our MLB player props. The same text that the website handles correctly returns "please provide a valid betslip input" in Discord. Flagging in case it's useful to your team.

Happy to work within whatever rate limits or attribution requirements you'd want.

Thanks for your time,

Eddie Jeter
Quant Betting — https://diamond-quant-live.vercel.app
edjeter11@gmail.com

---

## How to send

Submit via the partner form at https://playbookbot.com/partner.

One placeholder left: `[X members]` in the first paragraph — put your actual
Discord member count in, or cut the clause entirely. Don't inflate it; the ask
here is small and specific, and it doesn't need a big audience to be worth
their yes.

## Why the ask is phrased this way

The endpoint is real and already public in their client JS
(`bctn-sharpside.s3.amazonaws.com/js/splash.js`), along with the API key their
homepage uses. Using that key from a server would mean authenticating as them,
on their quota — so the letter names the endpoint openly and asks for our own
credential instead. That's a much easier yes than "please build us an API",
and it's the honest version of the request.
