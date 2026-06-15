from __future__ import annotations

import os
from typing import Iterable

import requests

from app.config import CareerSource


DEFAULT_SUPABASE_URL = "https://dqcpoxyadfsyfkvbgyen.supabase.co"
DEFAULT_SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY3BveHlhZGZzeWZrdmJneWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3NzY1MzYsImV4cCI6MjA2NjM1MjUzNn0."
    "c8bV15lHma2TNBGzg9uzS0dcnhDojYXu7ITjm5BrfBY"
)
DEFAULT_NEOHUNT_INGEST_TOKEN = "285ea77f7adae12334074d346540d5b6437929178d990080"


class SupabaseConfigError(RuntimeError):
    pass


class SupabaseJobStore:
    def __init__(self, url: str, api_key: str, ingest_token: str | None, direct_write: bool) -> None:
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.ingest_token = ingest_token
        self.direct_write = direct_write

    @classmethod
    def from_env(cls) -> "SupabaseJobStore":
        url = os.getenv("SUPABASE_URL") or DEFAULT_SUPABASE_URL
        anon_key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY") or DEFAULT_SUPABASE_ANON_KEY
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY")
        ingest_token = os.getenv("NEOHUNT_INGEST_TOKEN") or DEFAULT_NEOHUNT_INGEST_TOKEN
        api_key = service_key or anon_key
        direct_write = bool(service_key)

        if not url or not api_key or (not ingest_token and not direct_write):
            raise SupabaseConfigError(
                "Set SUPABASE_URL and either (SUPABASE_ANON_KEY + NEOHUNT_INGEST_TOKEN) or SUPABASE_SERVICE_ROLE_KEY before running the scraper."
            )
        return cls(url, api_key, ingest_token, direct_write)

    def _headers(self) -> dict[str, str]:
        return {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _raise_for_status(response: requests.Response) -> None:
        try:
            response.raise_for_status()
        except requests.HTTPError as error:
            message = response.text.strip()
            if message:
                raise requests.HTTPError(f"{error}. Response body: {message}", response=response) from error
            raise

    def mode_label(self) -> str:
        if self.direct_write:
            return "service-role direct write"
        return "anon key + ingest token RPC"

    def upsert_companies(self, sources: Iterable[CareerSource]) -> int:
        companies = [
            {
                "name": source.company,
                "career_url": source.url,
                "active": True,
            }
            for source in sources
        ]
        if not companies:
            return 0

        if self.direct_write:
            response = requests.post(
                f"{self.url}/rest/v1/companies",
                headers=self._headers(),
                params={"on_conflict": "name"},
                json=companies,
                timeout=60,
            )
            self._raise_for_status(response)
            return len(companies)

        response = requests.post(
            f"{self.url}/rest/v1/rpc/neohunt_ingest_snapshot",
            headers=self._headers(),
            json={
                "payload": {"companies": companies, "jobs": []},
                "ingest_token": self.ingest_token,
            },
            timeout=60,
        )
        self._raise_for_status(response)
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

        if self.direct_write:
            jobs_payload = payload["jobs"]
            if not jobs_payload:
                return 0

            response = requests.post(
                f"{self.url}/rest/v1/jobs",
                headers={**self._headers(), "Prefer": "resolution=merge-duplicates,return=representation"},
                params={"on_conflict": "job_url"},
                json=jobs_payload,
                timeout=60,
            )
            self._raise_for_status(response)

            stored_jobs = response.json() if response.text else []
            if isinstance(stored_jobs, dict):
                stored_jobs = [stored_jobs]

            if stored_jobs:
                matches_payload = []
                for stored_job in stored_jobs:
                    source_job = next(
                        (job for job in jobs if job.get("url") == stored_job.get("job_url")),
                        None,
                    )
                    if source_job:
                        matches_payload.append(
                            {
                                "job_id": stored_job["id"],
                                **source_job["match"],
                            }
                        )

                if matches_payload:
                    match_response = requests.post(
                        f"{self.url}/rest/v1/matches",
                        headers={**self._headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                        params={"on_conflict": "job_id"},
                        json=matches_payload,
                        timeout=60,
                    )
                    self._raise_for_status(match_response)

            return len(stored_jobs)

        response = requests.post(
            f"{self.url}/rest/v1/rpc/neohunt_ingest_snapshot",
            headers=self._headers(),
            json={
                "payload": payload,
                "ingest_token": self.ingest_token,
            },
            timeout=60,
        )
        self._raise_for_status(response)
        data = response.json()
        return int(data.get("stored_jobs", 0))
