# Diamond-Quant Live — Production Runbook

Everything you need to take this live end-to-end. Skip steps you've already done.

## 1. Supabase (required)

1. Create a new Supabase project.
2. Copy the URL + anon + service-role keys from **Settings → API**.
3. Open **SQL Editor**, paste and run each file in `supabase/migrations/` in order (001 → 006). See `supabase/migrations/README.md` for what each file does.

## 2. Vercel env vars (required for basics)

Settings → Environment Variables → Production:

```
NEXT_PUBLIC_SUPABASE_URL         = https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY    = <anon key>
SUPABASE_SERVICE_ROLE_KEY        = <service_role key — KEEP SECRET>
CRON_SECRET                      = <any 32+ char random string>
THE_ODDS_API_KEY_PAID            = <The Odds API paid key>
GEMINI_API_KEY                   = <Google AI Studio>
OPENWEATHER_API_KEY              = <OpenWeather free tier>
```

Redeploy after adding.

## 3. Stripe — activate paid subs

Without this the `/pricing` checkout does nothing.

1. Create a product in Stripe: "Diamond-Quant Pro" → recurring price $15/mo, **7-day free trial**
2. Copy the `price_...` ID from the product
3. Add to Vercel:
   ```
   NEXT_PUBLIC_STRIPE_PRO_PRICE_ID  = price_...
   STRIPE_SECRET_KEY                = sk_live_...
   STRIPE_WEBHOOK_SECRET            = whsec_... (generated in step 4)
   ```
4. Stripe → Developers → Webhooks → Add endpoint:
   - URL: `https://diamond-quant-live.vercel.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
5. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`

Test: a real paid signup should flip `user_profiles.is_premium = true`
automatically via the webhook, unlocking the full picks list for that user.

## 4. Push notifications (optional — for +EV alerts)

Browser push requires VAPID keys.

```bash
npx web-push generate-vapid-keys
```

Add to Vercel:
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY = <public>
VAPID_PRIVATE_KEY            = <private — KEEP SECRET>
VAPID_SUBJECT                = mailto:you@diamond-quant.com
```

After that, the existing `/sw.js` service worker can receive pushes.
Server-side trigger (e.g. in cron): use the `web-push` npm package to send
to each user's subscription stored in `user_preferences.push_subscription`.

*(Code wiring exists client-side but you'll add a `push_subscriptions`
column + server push call when you're ready to activate.)*

## 5. Admin user (for training + evolution)

The NBA brain training and evolution endpoints require `user_profiles.is_admin = true`.

Run this once in Supabase SQL Editor (replace with your user id):

```sql
UPDATE user_profiles
SET is_admin = true
WHERE email = 'you@example.com';
```

## 6. Cron verification

`vercel.json` has a 30-min cron on `/api/cron`. It handles:
- Completed-game logging
- NBA prop brain settlement
- Daily smart-picks generation (7-11 UTC window)
- Daily Discord recap (3-7 UTC window)
- Track-record settlement of daily picks
- Weekly NBA brain evolution (Sunday 0-2 UTC)

Check it ran by looking at Vercel → Functions → Logs for `/api/cron`.

## 7. Quick smoke test

1. Open the app — age gate removed, no auth wall on the main board
2. Switch MLB ↔ NBA — games / odds should load, logos visible
3. Open a prop pick — PropDetail panel shows stats + brain read + "Generate AI analysis" button
4. Add a pick — floating parlay chip bottom-right shows leg count + odds
5. Tap chip → stake input → Place Bet → toast confirms, bankroll updates
6. `/results` — shows track record (or "building our track record" state if no settled picks yet)
7. `/pricing` — shows Free + Pro ($15/mo) plans

## 8. Things NOT live yet (by design)

- Email daily recap (needs a transactional email provider like Resend — not wired)
- Server-side push triggers (SW ready, server trigger left for manual wiring)
- A couple v1 bot files (`lib/bot/bot-picks.ts`, `lib/bot/brain.ts`) still
  referenced by `BrainViz`, `ModelLogs`, `BankrollTracker` — harmless but
  candidates for a future refactor if those components are reworked
