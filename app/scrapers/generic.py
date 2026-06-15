from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

JOB_WORDS = [
    "product", "program", "technical", "manager", "payments", "platform",
    "digital", "owner", "channels", "fintech", "banking", "engineer"
]

GENERIC_LINK_TEXT = {
    "apply",
    "careers",
    "find your role",
    "job openings",
    "job opportunities",
    "jobs",
    "learn more",
    "open roles",
    "read more",
    "search",
    "search jobs",
    "find the job for me",
    "see open roles",
    "view jobs",
    "view all jobs",
    "view open roles",
    "we are hiring",
    "why work here",
}

BLOCKED_URL_PARTS = [
    "/about",
    "/blog",
    "/career-programs/",
    "/cookie",
    "/culture",
    "/diversity",
    "/events",
    "/faq",
    "/fraud-alert",
    "/graduate",
    "/internship",
    "/locations",
    "/login",
    "/media",
    "/privacy",
    "/products/",
    "/search",
    "/signin",
    "/terms",
    "/view-all-jobs",
    "facebook.com/",
    "instagram.com/",
    "linkedin.com/",
    "mailto:",
    "share",
    "twitter.com/",
    "youtube.com/",
]

JOB_DETAIL_PATTERNS = [
    (r"(^|\.)amazon\.jobs$", r"^/(?:[a-z]{2}/)?jobs/\d+"),
    (r"(^|\.)ashbyhq\.com$", r"^/[^/]+/[a-f0-9-]{20,}"),
    (r"(^|\.)greenhouse\.io$", r"/jobs/\d+"),
    (r"(^|\.)lever\.co$", r"^/[^/]+/[a-f0-9-]{20,}"),
    (r"(^|\.)myworkdayjobs\.com$", r"/job/"),
    (r"(^|\.)myworkdaysite\.com$", r"/job/"),
    (r"^careers\.mastercard\.com$", r"^/[a-z]{2}/[a-z]{2}/job/"),
    (r"^jobs\.careers\.microsoft\.com$", r"^/global/[a-z]{2}/job/"),
    (r"^jobs\.smartrecruiters\.com$", r"^/[^/]+/\d+"),
    (r"^job-boards\.greenhouse\.io$", r"/jobs/\d+"),
    (r"^ncbagroup\.com$", r"^/careers/join-our-team/.+"),
    (r"^oneacrefund\.org$", r"^/careers/job-openings/.+"),
    (r"^flutterwave\.com$", r"^/[a-z]{2}/careers/vacancies/.+"),
    (r"^www\.m-kopa\.com$", r"^/careers/.+"),
    (r"^ke\.kcbgroup\.com$", r"^/(?:about-us/)?careers/.+"),
    (r"^www\.standardbank\.com$", r"/careers/.+job"),
    (r"^www\.absa\.africa$", r"/careers/.+job"),
]

SOURCE_HOSTS_BY_COMPANY = {
    "Visa": {"usa.visa.com", "jobs.smartrecruiters.com"},
    "Mastercard": {"careers.mastercard.com"},
    "Safaricom": {"www.safaricom.co.ke", "safaricom.co.ke"},
    "Microsoft": {"jobs.careers.microsoft.com"},
    "Amazon": {"www.amazon.jobs", "amazon.jobs"},
    "One Acre Fund": {"oneacrefund.org", "www.oneacrefund.org"},
    "M-KOPA": {"www.m-kopa.com", "m-kopa.com", "jobs.lever.co", "job-boards.greenhouse.io", "boards.greenhouse.io"},
    "Flutterwave": {"flutterwave.com", "www.flutterwave.com", "jobs.ashbyhq.com", "boards.greenhouse.io", "job-boards.greenhouse.io"},
    "Standard Bank": {"www.standardbank.com", "standardbank.com", "standardbank.wd3.myworkdayjobs.com", "standardbankgroup.wd3.myworkdayjobs.com"},
    "Absa": {"www.absa.africa", "absa.africa", "absa.wd3.myworkdayjobs.com"},
    "KCB": {"ke.kcbgroup.com", "kcbgroup.com", "www.kcbgroup.com"},
    "NCBA": {"ncbagroup.com", "www.ncbagroup.com"},
}

AMAZON_SEARCH_TERMS = [
    "technical product manager",
    "technical program manager",
    "product manager",
    "product owner",
    "payments",
    "digital platform",
    "fintech",
]

WORKDAY_SOURCES = {
    "Mastercard": {
        "api_url": "https://mastercard.wd1.myworkdayjobs.com/wday/cxs/mastercard/CorporateCareers/jobs",
        "detail_base_url": "https://mastercard.wd1.myworkdayjobs.com/en-US/CorporateCareers",
        "source_url": "https://careers.mastercard.com/us/en",
    },
    "Absa": {
        "api_url": "https://absa.wd3.myworkdayjobs.com/wday/cxs/absa/ABSAcareersite/jobs",
        "detail_base_url": "https://absa.wd3.myworkdayjobs.com/en-US/ABSAcareersite",
        "source_url": "https://www.absa.africa/absaafrica/careers/",
    },
}

WORKDAY_SEARCH_TERMS = [
    "technical product manager",
    "technical program manager",
    "product manager",
    "product owner",
    "payments",
    "digital",
    "platform",
    "fintech",
    "banking",
]


def _looks_like_job(title: str, url: str) -> bool:
    text = f"{title} {url}".lower()
    return any(word in text for word in JOB_WORDS) and not any(x in text for x in ["privacy", "cookie", "terms"])


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _clean_html(text: str) -> str:
    return _clean(BeautifulSoup(text or "", "lxml").get_text(" "))


def _normalise_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/"), "", parsed.query, ""))


def _link_title(anchor) -> str:
    text = _clean(anchor.get_text(" "))
    if text:
        return text
    for attr in ("aria-label", "title"):
        value = _clean(anchor.get(attr, ""))
        if value:
            return value
    return ""


def _allowed_hosts(company: str, base_url: str) -> set[str]:
    source_host = urlparse(base_url).netloc.lower()
    hosts = {source_host}
    hosts.update(SOURCE_HOSTS_BY_COMPANY.get(company, set()))
    return {host.lstrip(".").lower() for host in hosts if host}


def _host_allowed(host: str, allowed_hosts: set[str]) -> bool:
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in allowed_hosts)


def _has_job_detail_shape(host: str, path: str) -> bool:
    for host_pattern, path_pattern in JOB_DETAIL_PATTERNS:
        if re.search(host_pattern, host) and re.search(path_pattern, path):
            return True
    return False


def _looks_like_job_detail(company: str, base_url: str, title: str, url: str) -> bool:
    lowered_title = title.lower().strip()
    lowered_url = url.lower()
    if not title or lowered_title in GENERIC_LINK_TEXT:
        return False
    if any(part in lowered_url for part in BLOCKED_URL_PARTS):
        return False

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False

    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if not _host_allowed(host, _allowed_hosts(company, base_url)):
        return False
    if not _has_job_detail_shape(host, path):
        return False

    return True


def _dedupe_jobs(jobs: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen_urls: set[str] = set()

    for job in jobs:
        url = job.get("url")
        if not url or url in seen_urls:
            continue
        deduped.append(job)
        seen_urls.add(url)

    return deduped


def scrape_amazon_jobs(company: str, source_url: str) -> list[dict]:
    jobs: list[dict] = []
    headers = {"User-Agent": "Mozilla/5.0 JobRadarBot/1.0", "Accept": "application/json"}

    for term in AMAZON_SEARCH_TERMS:
        response = requests.get(
            "https://www.amazon.jobs/en/search.json",
            headers=headers,
            params={
                "offset": 0,
                "result_limit": 15,
                "sort": "relevant",
                "base_query": term,
                "loc_query": "",
            },
            timeout=30,
        )
        response.raise_for_status()
        for item in response.json().get("jobs", []):
            job_path = item.get("job_path")
            title = _clean(item.get("title", ""))
            if not job_path or not title:
                continue
            jobs.append(
                {
                    "company": company,
                    "title": title[:160],
                    "location": _clean(item.get("location", "")),
                    "url": _normalise_url(urljoin("https://www.amazon.jobs", job_path)),
                    "description": _clean_html(item.get("description") or item.get("description_short") or title),
                    "source": source_url,
                    "posted_date": item.get("posted_date"),
                }
            )

    return _dedupe_jobs(jobs)


def scrape_workday_jobs(company: str) -> list[dict]:
    config = WORKDAY_SOURCES[company]
    jobs: list[dict] = []
    headers = {"User-Agent": "Mozilla/5.0 JobRadarBot/1.0", "Accept": "application/json"}

    for term in WORKDAY_SEARCH_TERMS:
        response = requests.post(
            config["api_url"],
            headers=headers,
            json={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": term},
            timeout=30,
        )
        response.raise_for_status()
        for item in response.json().get("jobPostings", []):
            external_path = item.get("externalPath")
            title = _clean(item.get("title", ""))
            if not external_path or not title:
                continue
            extra = " ".join(field for field in item.get("bulletFields", []) if field)
            jobs.append(
                {
                    "company": company,
                    "title": title[:160],
                    "location": _clean(item.get("locationsText", "")),
                    "url": _normalise_url(f"{config['detail_base_url'].rstrip('/')}{external_path}"),
                    "description": _clean(f"{title}. {item.get('locationsText', '')}. {extra}"),
                    "source": config["source_url"],
                }
            )

    return _dedupe_jobs(jobs)


def parse_jobs_from_html(company: str, base_url: str, html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    for a in soup.find_all("a"):
        title = _link_title(a)
        href = a.get("href")
        if not title or not href:
            continue
        full_url = _normalise_url(urljoin(base_url, href))
        if full_url in seen_urls:
            continue
        if _looks_like_job_detail(company, base_url, title, full_url):
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
        if company == "Amazon":
            return scrape_amazon_jobs(company, url)
        if company in WORKDAY_SOURCES:
            return scrape_workday_jobs(company)
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
