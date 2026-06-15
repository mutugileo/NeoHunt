from app.config import KEYWORDS, NEGATIVE_KEYWORDS


def score_job(title: str, description: str = "", location: str = "") -> tuple[int, list[str]]:
    text = f"{title} {description} {location}".lower()
    score = 0
    reasons: list[str] = []

    for keyword, weight in KEYWORDS.items():
        if keyword in text:
            score += weight
            reasons.append(keyword)

    for keyword, penalty in NEGATIVE_KEYWORDS.items():
        if keyword in text:
            score += penalty
            reasons.append(f"penalty: {keyword}")

    # Cap score into 0..100.
    return max(0, min(100, score)), reasons[:8]
