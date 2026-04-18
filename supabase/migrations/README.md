# Supabase Migrations

Run these **in order** via Supabase Dashboard → SQL Editor on a fresh project.
Each file is idempotent (uses `CREATE TABLE IF NOT EXISTS` / `DROP POLICY IF EXISTS`).

| # | File | What it creates |
|---|---|---|
| 1 | `001_setup.sql` | Core `app_state` key-value table + RLS |
| 2 | `002_auth_and_users.sql` | `user_profiles`, `user_state`, `user_preferences`, `invites`, `rate_limits`, `shared_slips` + RLS + signup trigger |
| 3 | `003_odds_history.sql` | `odds_history` snapshots for the odds movement tracker |
| 4 | `004_prop_predictions.sql` | `prop_predictions` closed-loop learning table for the NBA prop brain |
| 5 | `005_track_record.sql` | `daily_picks_log` for the public `/results` page + `is_premium` / Stripe columns on `user_profiles` |
| 6 | `006_security_hardening.sql` | Tightens RLS: removes public DELETE on `odds_history`, restricts `shared_slips` inserts to JWT subject |

## After running

1. Set these Vercel env vars:
   - `NEXT_PUBLIC_SUPABASE_URL` (from Supabase → Settings → API)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (required for server-side cron writes)
   - `CRON_SECRET` (any random ≥32-char string — used by self-calling cron jobs)

2. For the $15/mo subscription to accept real money:
   - Create a Stripe product + recurring price with 7-day trial
   - `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` = the `price_...` ID
   - `STRIPE_SECRET_KEY` = your secret key
   - `STRIPE_WEBHOOK_SECRET` = from the Stripe CLI / dashboard webhook setup
   - Configure webhook at `https://<your-domain>/api/stripe/webhook` for
     `checkout.session.completed` + `customer.subscription.deleted`

3. For weather badges on MLB game cards:
   - `OPENWEATHER_API_KEY` = OpenWeather free-tier key

4. For AI summaries and bet-slip OCR:
   - `GEMINI_API_KEY` = Google AI Studio key
