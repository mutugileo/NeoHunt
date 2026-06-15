import hashlib
import json
from pathlib import Path
from typing import Iterable

SEEN_FILE = Path("data/seen_jobs.json")


def job_key(job: dict) -> str:
    raw = "|".join([
        job.get("company", "").strip().lower(),
        job.get("title", "").strip().lower(),
        job.get("location", "").strip().lower(),
        job.get("url", "").strip().lower(),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_seen() -> set[str]:
    if not SEEN_FILE.exists():
        return set()
    try:
        return set(json.loads(SEEN_FILE.read_text()))
    except Exception:
        return set()


def save_seen(keys: Iterable[str]) -> None:
    SEEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(sorted(set(keys)), indent=2))
