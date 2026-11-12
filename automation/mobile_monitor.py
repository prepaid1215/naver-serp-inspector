"""Backward-compatible entry point for the v2 mobile blog monitor.

New code lives in focused modules so extraction, evidence validation, ownership,
and scheduling can be tested independently.
"""
from __future__ import annotations

from automation.collector import collect_all
from automation.models import GROUPS
from automation.owners import PEOPLE, canonical_posts, owner_matches, parse_blog_post
from automation.scheduler import aggregate_groups, recommend


def blog_article(url: str) -> dict | None:
    """Compatibility shape for callers from the original monitor."""

    post = parse_blog_post(url)
    if not post:
        return None
    return {
        "id": post["blog_id"],
        "post": post["post_id"],
        "url": post["post_url"],
    }


def people_from_urls(urls: list[str]) -> dict:
    matches = owner_matches(canonical_posts(urls))
    return {
        owner: [
            {
                "rank": row["rank"],
                "id": row["blog_id"],
                "post": row["post_id"],
                "url": row["post_url"],
            }
            for row in rows
        ]
        for owner, rows in matches.items()
    }


def run() -> dict:
    return collect_all()


if __name__ == "__main__":
    run()


__all__ = [
    "GROUPS",
    "PEOPLE",
    "aggregate_groups",
    "blog_article",
    "people_from_urls",
    "recommend",
    "run",
]
