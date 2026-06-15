# NeoHunt

NeoHunt is a job radar for product, platform, payments, and digital roles. V1 keeps the moving parts simple:

```text
GitHub Actions
  -> Python scrapers
  -> Supabase PhaseTwo
  -> NeoHunt website
```

The email step has been removed. The scraper now writes roles into Supabase, stores match analysis, and the website reads the ranked feed.

## Supabase Tables

PhaseTwo now has three NeoHunt tables in `public`:

- `companies` stores each job source and career URL.
- `jobs` stores scraped roles, score, status, and source URL.
- `matches` stores the ranking explanation: strengths, gaps, CV angle, and decision.

RLS is enabled. `anon` and `authenticated` can read the tables, while writes go through the locked RPC that the Python scraper calls with an ingest token.

## Local Scraper Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
```

Edit `.env`:

```text
SUPABASE_URL=https://dqcpoxyadfsyfkvbgyen.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_or_publishable_key
NEOHUNT_INGEST_TOKEN=285ea77f7adae12334074d346540d5b6437929178d990080
MIN_SCORE=70
```

Then run:

```bash
python -m app.main
```

You should see each company scrape, followed by the number of jobs stored in Supabase.

## Website Preview

The website lives in `web/`.

```bash
python -m http.server 4173 --directory web
```

Open:

```text
http://localhost:4173
```

`web/config.js` contains the public Supabase URL and anon key for the read-only job feed. Keep service role keys out of this file.

## GitHub Actions

Add these repository secrets:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEOHUNT_INGEST_TOKEN
MIN_SCORE
```

The scheduled workflow runs twice a day, at 06:00 and 14:00 Kenya time, and writes the latest scrape into Supabase.

## Tune Matching

Edit `app/config.py`:

- Add or remove `CareerSource` entries.
- Adjust `KEYWORDS` and `NEGATIVE_KEYWORDS`.
- Change `MIN_SCORE` in `.env` or GitHub Secrets.

The current match layer is deterministic. It is ready for a stronger AI pass once the CV/profile text and ranking prompt are finalized.
