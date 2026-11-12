"""Canonical Naver Blog post parsing and configured owner matching.

Only public post URLs are accepted. Profile URLs and non-Naver hosts are never
counted as exposure evidence.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


PEOPLE: dict[str, tuple[str, ...]] = {
    "건호": ("carrotmobile_", "lifeon5g_"),
    "영은": ("esim99_", "esim99", "esim87_"),
    "하루": ("ntelecom59",),
    "수진": ("jjuny1253",),
}

BLOG_TO_OWNER = {
    blog_id.casefold(): owner
    for owner, blog_ids in PEOPLE.items()
    for blog_id in blog_ids
}

_BLOG_ID = re.compile(r"[A-Za-z0-9_-]{2,40}")
_LOG_NO = re.compile(r"\d{5,20}")


def parse_blog_post(url: object) -> dict | None:
    """Return canonical post metadata for a supported Naver Blog post URL."""

    if not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").casefold()
    if parsed.scheme not in {"http", "https"} or host not in {
        "blog.naver.com",
        "m.blog.naver.com",
    }:
        return None

    parts = [part for part in parsed.path.split("/") if part]
    blog_id = ""
    log_no = ""
    if len(parts) >= 2 and _BLOG_ID.fullmatch(parts[0]) and _LOG_NO.fullmatch(parts[1]):
        blog_id, log_no = parts[0], parts[1]
    elif parts and parts[0].casefold() in {"postview.naver", "postview.nhn"}:
        params = parse_qs(parsed.query)
        blog_id = params.get("blogId", [""])[0]
        log_no = params.get("logNo", [""])[0]
        if not _BLOG_ID.fullmatch(blog_id) or not _LOG_NO.fullmatch(log_no):
            return None
    else:
        return None

    normalized_id = blog_id.casefold()
    return {
        "blog_id": normalized_id,
        "post_id": log_no,
        "post_url": f"https://blog.naver.com/{normalized_id}/{log_no}",
        "owner": BLOG_TO_OWNER.get(normalized_id),
    }


def canonical_posts(urls: list[object], limit: int = 10) -> list[dict]:
    """Normalize, de-duplicate, and rank valid post URLs in source order."""

    posts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for url in urls:
        post = parse_blog_post(url)
        if not post:
            continue
        key = (post["blog_id"], post["post_id"])
        if key in seen:
            continue
        seen.add(key)
        posts.append({"rank": len(posts) + 1, **post})
        if len(posts) >= limit:
            break
    return posts


def owner_matches(results: list[dict]) -> dict[str, list[dict]]:
    """Group canonical ranked result rows by configured owner."""

    matches = {owner: [] for owner in PEOPLE}
    for row in results[:10]:
        post = parse_blog_post(row.get("post_url"))
        if not post or not post["owner"]:
            continue
        try:
            rank = int(row.get("rank"))
        except (TypeError, ValueError):
            continue
        if not 1 <= rank <= 10:
            continue
        matches[post["owner"]].append(
            {
                "rank": rank,
                "blog_id": post["blog_id"],
                "post_id": post["post_id"],
                "post_url": post["post_url"],
            }
        )
    for rows in matches.values():
        rows.sort(key=lambda item: (item["rank"], item["post_url"]))
    return matches

