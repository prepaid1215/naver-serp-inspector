"""Versioned data model and conservative validation for blog operations."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Iterable

from automation.owners import canonical_posts, parse_blog_post


KST = timezone(timedelta(hours=9))
SCHEMA = "naver-blog-ops-v2"
HISTORY_SCHEMA = "naver-blog-ops-history-v2"
SURFACE_SECTION = "INTEGRATED_BLOG_SECTION_TOP10"
SURFACE_ARTICLES = "INTEGRATED_BLOG_ARTICLES_TOP10"
SURFACE_BLOG_TAB = "BLOG_TAB_TOP10"
# Operating metric: observed order of blog post cards inside Naver's mobile
# integrated-search UGC feed (not an official Naver rank, not a blog "section").
SURFACE_FEED = "INTEGRATED_FEED_BLOG_CARDS_TOP10"
DECISION_SURFACE = SURFACE_FEED
SURFACES = {SURFACE_SECTION, SURFACE_ARTICLES, SURFACE_BLOG_TAB, SURFACE_FEED}
FEED_AUDIT_METHOD = "automated_feed_crosscheck"
FEED_AUDIT_FLAGS = ("order_consistent", "non_overlapping", "no_excluded_cards", "post_unique")
# Windows headed-browser run: also compares what is painted on screen and the
# saved full-page screenshot with the extracted card order.
LOCAL_AUDIT_METHOD = "local_headed_visual_crosscheck"
LOCAL_AUDIT_FLAGS = (
    "screen_hit_test",
    "screen_order",
    "title_matches_screen",
    "screenshot_size_matches",
    "screenshot_crops_nonblank",
    "stable_rerun",
)
STATUSES = {
    "VERIFIED",
    "CANDIDATE",
    "PARTIAL",
    "BLOCKED",
    "ERROR",
    "STALE",
    "UNKNOWN",
    "NOT_FOUND",
}
FRESHNESS_MINUTES = 45

GROUPS: dict[str, tuple[str, ...]] = {
    "KT바로유심": ("KT바로유심", "바로유심", "KT바로유심 개통"),
    "LG모두의 원칩": ("LG모두의 원칩", "모두의 원칩", "LG원칩 개통"),
    "태블릿소유자회원번호": (
        "태블릿소유자회원번호",
        "태블릿 소유자 회원번호",
        "태블릿소유자회원번호 입력",
    ),
    "다이소 유심": ("다이소 유심", "다이소 선불유심", "다이소 유심 개통"),
}


def now_kst() -> datetime:
    return datetime.now(KST)


def iso_kst(value: datetime | None = None) -> str:
    value = value or now_kst()
    if value.tzinfo is None:
        value = value.replace(tzinfo=KST)
    return value.astimezone(KST).isoformat()


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def effective_status(observation: dict | None, at: datetime | None = None) -> str:
    """Return STALE for old usable observations without mutating stored truth."""

    if not isinstance(observation, dict):
        return "UNKNOWN"
    status = observation.get("status", "UNKNOWN")
    if status not in STATUSES:
        return "UNKNOWN"
    if status in {"BLOCKED", "ERROR", "UNKNOWN"}:
        return status
    observed = parse_time(observation.get("observed_at"))
    reference = at or now_kst()
    if not observed or reference.astimezone(KST) - observed > timedelta(minutes=FRESHNESS_MINUTES):
        return "STALE"
    return status


def make_observation(
    *,
    surface: str,
    status: str,
    observed_at: str,
    results: Iterable[dict] = (),
    evidence: dict | None = None,
    reason: str = "",
    reason_code: str = "",
) -> dict:
    if surface not in SURFACES:
        raise ValueError(f"unsupported surface: {surface}")
    if status not in STATUSES:
        raise ValueError(f"unsupported status: {status}")
    rows = []
    for row in results:
        post = parse_blog_post(row.get("post_url") if isinstance(row, dict) else None)
        if not post:
            continue
        entry = {"rank": len(rows) + 1, **post}
        if isinstance(row.get("feed_rank"), int) and row["feed_rank"] >= 1:
            entry["feed_rank"] = row["feed_rank"]
        if isinstance(row.get("title"), str) and row["title"].strip():
            entry["title"] = " ".join(row["title"].split())[:120]
        rows.append(entry)
        if len(rows) == 10:
            break
    return {
        "surface": surface,
        "status": status,
        "observed_at": observed_at,
        "reason": reason,
        "reason_code": reason_code,
        "evidence": deepcopy(evidence or {}),
        "results": rows,
    }


def validate_observation(observation: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(observation, dict):
        return ["observation must be an object"]
    surface = observation.get("surface")
    status = observation.get("status")
    if surface not in SURFACES:
        errors.append("invalid surface")
    if status not in STATUSES:
        errors.append("invalid status")
    if not parse_time(observation.get("observed_at")):
        errors.append("invalid observed_at")
    results = observation.get("results")
    if not isinstance(results, list):
        errors.append("results must be a list")
        results = []
    seen: set[str] = set()
    for index, row in enumerate(results, 1):
        if not isinstance(row, dict) or row.get("rank") != index:
            errors.append("result ranks must be sequential")
            break
        post = parse_blog_post(row.get("post_url")) if isinstance(row, dict) else None
        if not post:
            errors.append("invalid post URL")
            break
        if post["post_url"] in seen:
            errors.append("duplicate post URL")
            break
        seen.add(post["post_url"])

    if status == "VERIFIED":
        evidence = observation.get("evidence") or {}
        method = evidence.get("verification_method")
        if surface not in {SURFACE_SECTION, SURFACE_FEED}:
            errors.append("only section or feed-card observations can be VERIFIED")
        if len(results) != 10:
            errors.append("VERIFIED requires exactly 10 posts")
        if not evidence.get("screenshot_sha256"):
            errors.append("VERIFIED requires screenshot SHA-256")
        if surface == SURFACE_FEED:
            audit = evidence.get("feed_audit") or {}
            if method not in {FEED_AUDIT_METHOD, LOCAL_AUDIT_METHOD, "human_visual_review"}:
                errors.append("VERIFIED feed requires cross-check or visual review evidence")
            required = FEED_AUDIT_FLAGS + (LOCAL_AUDIT_FLAGS if method == LOCAL_AUDIT_METHOD else ())
            if method != "human_visual_review" and not all(audit.get(flag) is True for flag in required):
                errors.append("VERIFIED feed requires every audit flag to pass")
            ranks = [row.get("feed_rank") for row in results]
            if any(not isinstance(rank, int) for rank in ranks) or ranks != sorted(ranks):
                errors.append("VERIFIED feed requires increasing feed_rank values")
        else:
            if method not in {"human_visual_review", "approved_golden_sample"}:
                errors.append("VERIFIED requires visual review evidence")
            if not evidence.get("section_name"):
                errors.append("VERIFIED requires a section name")
            if not evidence.get("reviewed_by"):
                errors.append("VERIFIED requires reviewer identity")
    if status == "CANDIDATE" and len(results) < 10:
        errors.append("CANDIDATE requires 10 posts")
    if status == "PARTIAL" and len(results) >= 10:
        errors.append("PARTIAL cannot contain 10 posts")
    if status in {"BLOCKED", "ERROR", "UNKNOWN"} and results:
        errors.append(f"{status} cannot contain ranked results")
    return errors


def validate_run(run: object) -> list[str]:
    if not isinstance(run, dict):
        return ["run must be an object"]
    errors: list[str] = []
    if run.get("schema") != SCHEMA:
        errors.append("invalid run schema")
    if not run.get("run_id"):
        errors.append("missing run_id")
    if not parse_time(run.get("captured_at_kst")):
        errors.append("invalid captured_at_kst")
    queries = run.get("queries")
    if not isinstance(queries, dict):
        return errors + ["queries must be an object"]
    expected = {query for variants in GROUPS.values() for query in variants}
    missing = expected - set(queries)
    if missing:
        errors.append(f"missing queries: {', '.join(sorted(missing))}")
    for query, record in queries.items():
        if not isinstance(record, dict):
            errors.append(f"{query}: record must be an object")
            continue
        surfaces = record.get("surfaces")
        if not isinstance(surfaces, dict):
            errors.append(f"{query}: surfaces must be an object")
            continue
        for surface_name, observation in surfaces.items():
            if surface_name != observation.get("surface") if isinstance(observation, dict) else True:
                errors.append(f"{query}/{surface_name}: surface key mismatch")
            errors.extend(
                f"{query}/{surface_name}: {message}"
                for message in validate_observation(observation)
            )
    return errors


def query_status(record: dict | None, at: datetime | None = None) -> str:
    """The feed-card surface is the product's primary decision metric."""

    observation = (record or {}).get("surfaces", {}).get(DECISION_SURFACE)
    return effective_status(observation, at)


def candidate_urls(record: dict | None) -> list[str]:
    observation = (record or {}).get("surfaces", {}).get(SURFACE_ARTICLES, {})
    return [row["post_url"] for row in observation.get("results", []) if row.get("post_url")]


def migrate_legacy_run(legacy: dict, captured_at: str | None = None) -> dict:
    """Preserve v1 links strictly as candidate article-order evidence."""

    stamp = captured_at or legacy.get("captured_at_kst") or iso_kst()
    queries: dict[str, dict] = {}
    for variants in GROUPS.values():
        for query in variants:
            old = (legacy.get("queries") or {}).get(query, {})
            observed_at = old.get("observed_at") or stamp
            raw_urls = old.get("urls") or old.get("candidate_urls") or old.get("preview_urls") or []
            posts = canonical_posts(raw_urls)
            if old.get("status") == "blocked":
                article_status = section_status = "BLOCKED"
                posts = []
            elif old.get("status") == "error":
                article_status = section_status = "ERROR"
                posts = []
            else:
                article_status = "CANDIDATE" if len(posts) == 10 else "PARTIAL"
                section_status = "UNKNOWN"
            evidence = {
                "source_url": old.get("url", ""),
                "viewport": "390x844",
                "verification_method": "legacy_dom_link_order",
                "legacy_basis": old.get("basis", ""),
            }
            queries[query] = {
                "query": query,
                "surfaces": {
                    SURFACE_SECTION: make_observation(
                        surface=SURFACE_SECTION,
                        status=section_status,
                        observed_at=observed_at,
                        evidence=evidence,
                        reason="기존 자료에는 블로그 영역 경계의 시각 검증이 없음",
                        reason_code="LEGACY_UNVERIFIED_SECTION",
                    ),
                    SURFACE_ARTICLES: make_observation(
                        surface=SURFACE_ARTICLES,
                        status=article_status,
                        observed_at=observed_at,
                        results=posts,
                        evidence=evidence,
                        reason="모바일 통합검색에서 발견된 블로그 게시글의 화면 순서 후보",
                        reason_code="LEGACY_ARTICLE_ORDER",
                    ),
                },
            }
    return {
        "schema": SCHEMA,
        "run_id": f"legacy-{stamp}",
        "captured_at_kst": stamp,
        "freshness_minutes": FRESHNESS_MINUTES,
        "collector": {
            "kind": "legacy_migration",
            "viewport": "390x844",
            "rank_policy": "verified_section_only",
        },
        "people": legacy.get("people", {}),
        "queries": queries,
        "groups": {},
        "recommendation": {
            "status": "PENDING",
            "ready": False,
            "assignments": [],
            "unassigned": ["건호", "영은", "하루", "수진"],
            "note": "기존 후보 링크는 확정 순위 또는 배정 근거로 사용하지 않음",
        },
        "errors": list(legacy.get("errors") or []),
    }

