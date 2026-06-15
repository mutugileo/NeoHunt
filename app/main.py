from __future__ import annotations

from dotenv import load_dotenv

from app.config import SOURCES, MIN_SCORE
from app.scoring.matcher import score_job
from app.scrapers.generic import scrape_company
from app.storage.seen_store import job_key
from app.storage.supabase_store import SupabaseJobStore


def build_match(job: dict) -> dict:
    reasons = [reason for reason in job.get("reasons", []) if not reason.startswith("penalty:")]
    penalties = [reason.replace("penalty: ", "") for reason in job.get("reasons", []) if reason.startswith("penalty:")]
    score = int(job.get("score", 0))

    if reasons:
        strengths = "\n".join(f"- {reason.title()}" for reason in reasons)
    else:
        strengths = "- Needs a closer human read"

    if penalties:
        gaps = "\n".join(f"- Role mentions {penalty}" for penalty in penalties)
    elif score >= 80:
        gaps = "- None significant from the scraped text"
    else:
        gaps = "- Scraped page has limited detail, so confirm scope before applying"

    if score >= 85:
        decision = "apply"
    elif score >= MIN_SCORE:
        decision = "review"
    else:
        decision = "monitor"

    return {
        "match_score": score,
        "strengths": strengths,
        "gaps": gaps,
        "cv_angle": "Lead with 2.3M users, 60M annual transactions, and multi-market delivery.",
        "decision": decision,
    }


def enrich_jobs(jobs: list[dict]) -> list[dict]:
    enriched_jobs: list[dict] = []

    for job in jobs:
        key = job_key(job)
        score, reasons = score_job(job.get("title", ""), job.get("description", ""), job.get("location", ""))
        job["score"] = score
        job["reasons"] = reasons
        job["key"] = key
        job["match"] = build_match(job)
        enriched_jobs.append(job)

    enriched_jobs.sort(key=lambda j: j.get("score", 0), reverse=True)
    return enriched_jobs


def run() -> None:
    load_dotenv()
    all_jobs: list[dict] = []
    store = SupabaseJobStore.from_env()
    print(f"Supabase configured: {store.mode_label()}")
    store.upsert_companies(SOURCES)

    for source in SOURCES:
        print(f"Scraping {source.company}...")
        jobs = scrape_company(source.company, source.url, source.use_playwright)
        print(f"  found {len(jobs)} possible jobs")
        all_jobs.extend(jobs)

    enriched_jobs = enrich_jobs(all_jobs)
    stored_count = store.upsert_jobs(enriched_jobs)
    strong_matches = [job for job in enriched_jobs if job.get("score", 0) >= MIN_SCORE]

    print(f"Stored {stored_count} jobs in Supabase.")
    print(f"{len(strong_matches)} jobs scored at or above {MIN_SCORE}%.")


if __name__ == "__main__":
    run()
