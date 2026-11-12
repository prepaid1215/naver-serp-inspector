"""Human visual-audit gate for the integrated blog-section metric."""
from __future__ import annotations

import re
from copy import deepcopy

from automation.models import SURFACE_SECTION, make_observation, validate_observation
from automation.owners import canonical_posts


_SHA256 = re.compile(r"[0-9a-f]{64}")


def manual_verified_observation(
    *,
    urls: list[str],
    observed_at: str,
    source_url: str,
    screenshot_sha256: str,
    reviewed_by: str,
    section_name: str = "블로그",
    review_note: str = "",
) -> dict:
    """Create VERIFIED evidence only after all visual-audit fields are present."""

    posts = canonical_posts(urls)
    if len(posts) != 10:
        raise ValueError("수동 검증에는 서로 다른 블로그 게시글 URL 10개가 필요합니다.")
    digest = screenshot_sha256.strip().casefold()
    if not _SHA256.fullmatch(digest):
        raise ValueError("스크린샷 SHA-256은 64자리 16진수여야 합니다.")
    if not reviewed_by.strip():
        raise ValueError("검수자 식별값이 필요합니다.")
    if not section_name.strip():
        raise ValueError("확인한 영역 이름이 필요합니다.")
    observation = make_observation(
        surface=SURFACE_SECTION,
        status="VERIFIED",
        observed_at=observed_at,
        results=posts,
        evidence={
            "source_url": source_url,
            "viewport": "390x844",
            "screenshot_sha256": digest,
            "verification_method": "human_visual_review",
            "reviewed_by": reviewed_by.strip(),
            "section_name": section_name.strip(),
            "review_note": review_note.strip(),
        },
        reason="블로그 영역 경계와 화면 순서 수동 검수 완료",
        reason_code="HUMAN_VISUAL_REVIEW",
    )
    errors = validate_observation(observation)
    if errors:
        raise ValueError("; ".join(errors))
    return observation


def approve_candidate(
    candidate: dict,
    *,
    screenshot_sha256: str,
    reviewed_by: str,
    review_note: str = "",
) -> dict:
    """Promote a complete section candidate without changing its ranked URLs."""

    if candidate.get("surface") != SURFACE_SECTION or candidate.get("status") != "CANDIDATE":
        raise ValueError("완전한 블로그 영역 CANDIDATE만 검수 승인할 수 있습니다.")
    evidence = candidate.get("evidence") or {}
    return manual_verified_observation(
        urls=[row.get("post_url", "") for row in candidate.get("results", [])],
        observed_at=candidate.get("observed_at", ""),
        source_url=evidence.get("source_url", ""),
        screenshot_sha256=screenshot_sha256,
        reviewed_by=reviewed_by,
        section_name=evidence.get("section_name", "블로그"),
        review_note=review_note,
    )


def attach_verified(query_record: dict, observation: dict) -> dict:
    """Return a copy with one approved section observation attached."""

    errors = validate_observation(observation)
    if errors or observation.get("status") != "VERIFIED":
        raise ValueError("invalid verified observation: " + "; ".join(errors))
    result = deepcopy(query_record)
    result.setdefault("surfaces", {})[SURFACE_SECTION] = deepcopy(observation)
    return result

