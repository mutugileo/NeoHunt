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

PhaseTwo now has four NeoHunt tables in `public`:

- `companies` stores each job source and career URL.
- `jobs` stores scraped roles, score, status, and source URL.
- `matches` stores the ranking explanation: strengths, gaps, CV angle, and decision.
- `user_preferences` stores each signed-in user's country, region, keywords, and companies.

RLS is enabled. `anon` and `authenticated` can read the public job tables, while writes go through the locked RPC that the Python scraper calls with an ingest token. `user_preferences` is only available to authenticated users, and each account can only read or update its own radar.

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

`web/config.js` contains the public Supabase URL and anon key for Supabase Auth and the job feed. Keep service role keys out of this file.

The website now starts with login/register. During registration, users choose a country, region, keywords, and companies. After login, they can update the same radar from the home page; the feed only shows jobs matching that user's saved country or region, companies, and keywords.

## GitHub Actions

Add these repository secrets:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEOHUNT_INGEST_TOKEN
MIN_SCORE
```

The workflow has PhaseTwo defaults for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `NEOHUNT_INGEST_TOKEN`, so it can run before secrets are added. Repository secrets override those defaults when present.

The scheduled workflow runs twice a day, at 06:00 and 14:00 Kenya time, and writes the latest scrape into Supabase.

## Tune Matching

Edit `app/config.py`:

- Add or remove `CareerSource` entries.
- Adjust `KEYWORDS` and `NEGATIVE_KEYWORDS`.
- Change `MIN_SCORE` in `.env` or GitHub Secrets.

The current match layer is deterministic. It is ready for a stronger AI pass once the CV/profile text and ranking prompt are finalized.
