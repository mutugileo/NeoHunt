from __future__ import annotations

import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

JOB_WORDS = [
    "product", "program", "technical", "manager", "payments", "platform",
    "digital", "owner", "channels", "fintech", "banking", "engineer"
]


def _looks_like_job(title: str, url: str) -> bool:
    text = f"{title} {url}".lower()
    return any(word in text for word in JOB_WORDS) and not any(x in text for x in ["privacy", "cookie", "terms"])


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def parse_jobs_from_html(company: str, base_url: str, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for a in soup.find_all("a"):
        title = _clean(a.get_text(" "))
        href = a.get("href")
        if not title or not href:
            continue
        full_url = urljoin(base_url, href)
        if full_url in seen_urls:
            continue
        if _looks_like_job(title, full_url):
            jobs.append({
                "company": company,
                "title": title[:160],
                "location": "",
                "url": full_url,
                "description": title,
                "source": base_url,
            })
            seen_urls.add(full_url)

    return jobs


def scrape_static(company: str, url: str) -> list[dict]:
    headers = {"User-Agent": "Mozilla/5.0 JobRadarBot/1.0"}
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return parse_jobs_from_html(company, url, response.text)


def scrape_playwright(company: str, url: str) -> list[dict]:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent="Mozilla/5.0 JobRadarBot/1.0")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        html = page.content()
        browser.close()
    return parse_jobs_from_html(company, url, html)


def scrape_company(company: str, url: str, use_playwright: bool = True) -> list[dict]:
    try:
        if use_playwright:
            return scrape_playwright(company, url)
        return scrape_static(company, url)
    except Exception as first_error:
        if use_playwright:
            try:
                return scrape_static(company, url)
            except Exception:
                pass
        print(f"[WARN] Could not scrape {company}: {first_error}")
        return []
