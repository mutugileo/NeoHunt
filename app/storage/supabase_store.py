from __future__ import annotations

import os
from typing import Iterable

import requests

from app.config import CareerSource


class SupabaseConfigError(RuntimeError):
    pass


class SupabaseJobStore:
    def __init__(self, url: str, anon_key: str, ingest_token: str) -> None:
        self.url = url.rstrip("/")
        self.anon_key = anon_key
        self.ingest_token = ingest_token

    @classmethod
    def from_env(cls) -> "SupabaseJobStore":
        url = os.getenv("SUPABASE_URL")
        anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        ingest_token = os.getenv("NEOHUNT_INGEST_TOKEN")
        if not url or not anon_key or not ingest_token:
            raise SupabaseConfigError(
                "Set SUPABASE_URL, SUPABASE_ANON_KEY, and NEOHUNT_INGEST_TOKEN before running the scraper."
            )
        return cls(url, anon_key, ingest_token)

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.anon_key}",
            "Content-Type": "application/json",
        }

    def upsert_companies(self, sources: Iterable[CareerSource]) -> int:
        companies = [
            {
                "name": source.company,
                "career_url": source.url,
                "active": True,
            }
            for source in sources
        ]
        return len(companies)

    def upsert_jobs(self, jobs: list[dict]) -> int:
        payload = {
            "companies": [
                {
                    "name": job.get("company") or "",
                    "career_url": job.get("source") or "",
                    "active": True,
                }
                for job in jobs
                if job.get("company") and job.get("source")
            ],
            "jobs": [
                {
                    "company": job.get("company") or "",
                    "title": job.get("title") or "",
                    "location": job.get("location") or None,
                    "description": job.get("description") or None,
                    "job_url": job.get("url"),
                    "source": job.get("source") or None,
                    "posted_date": job.get("posted_date"),
                    "scraped_at": job.get("scraped_at"),
                    "score": int(job.get("score", 0)),
                    "status": "new",
                    "match": job.get("match"),
                }
                for job in jobs
                if job.get("url")
            ],
        }

        response = requests.post(
            f"{self.url}/rest/v1/rpc/neohunt_ingest_snapshot",
            headers=self._headers(),
            json={
                "payload": payload,
                "ingest_token": self.ingest_token,
            },
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        return int(data.get("stored_jobs", 0))
