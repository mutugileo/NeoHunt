import os
from dataclasses import dataclass


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    return int(raw)


KEYWORDS = {
    "technical product manager": 25,
    "technical program manager": 22,
    "product manager": 18,
    "product owner": 16,
    "digital platforms": 16,
    "digital channels": 15,
    "payments": 15,
    "fintech": 12,
    "banking": 12,
    "platform": 10,
    "api": 8,
    "integration": 8,
    "mobile": 8,
    "africa": 6,
    "kenya": 6,
    "remote": 5,
    "cloud": 5,
}

NEGATIVE_KEYWORDS = {
    "intern": -30,
    "graduate trainee": -25,
    "entry level": -20,
    "sales agent": -20,
    "customer care": -20,
}

@dataclass
class CareerSource:
    company: str
    url: str
    use_playwright: bool = True

SOURCES = [
    CareerSource("Visa", "https://usa.visa.com/careers.html"),
    CareerSource("Mastercard", "https://careers.mastercard.com/us/en"),
    CareerSource("Safaricom", "https://www.safaricom.co.ke/about/careers"),
    CareerSource("Microsoft", "https://jobs.careers.microsoft.com/global/en/search"),
    CareerSource("Amazon", "https://www.amazon.jobs/en/search"),
    CareerSource("One Acre Fund", "https://oneacrefund.org/careers/"),
    CareerSource("M-KOPA", "https://www.m-kopa.com/careers/"),
    CareerSource("Flutterwave", "https://flutterwave.com/us/careers"),
    CareerSource("Standard Bank", "https://www.standardbank.com/sbg/standard-bank-group/careers"),
    CareerSource("Absa", "https://www.absa.africa/absaafrica/careers/"),
    CareerSource("KCB", "https://ke.kcbgroup.com/about-us/careers"),
    CareerSource("NCBA", "https://ncbagroup.com/careers/"),
]

MIN_SCORE = env_int("MIN_SCORE", 70)
