"""Shared helpers for the score-import scripts (import-scores.py, build-packs.py)."""
import csv, re

SCORES = "data-src/full_scores.csv"
USABLE = "ai_initial_estimate"


def load_rows(path=SCORES):
    return list(csv.DictReader(open(path, encoding="utf-8-sig")))


def cutoffs(rows):
    """Score thresholds at the 1/3 and 2/3 points of all usable scores.

    One vote per (normalized word, meaning) so word lists that repeat each other
    don't skew the thresholds. Level 1 is score <= t1, level 3 is score > t2.
    """
    seen, scores = set(), []
    for r in rows:
        if r["review_status"] != USABLE or not r["initial_difficulty"]:
            continue
        k = (re.sub(r"\W", "", r["word"].lower()), r["meaning_zh"])
        if k not in seen:
            seen.add(k)
            scores.append(int(r["initial_difficulty"]))
    scores.sort()
    return scores[len(scores) // 3], scores[len(scores) * 2 // 3], len(scores)


def level_of(score, t1, t2):
    return 1 if score <= t1 else 3 if score > t2 else 2
