"""Browser extraction adapter that keeps section and article-order metrics apart."""
from __future__ import annotations

from automation.models import (
    SURFACE_ARTICLES,
    SURFACE_SECTION,
    make_observation,
)
from automation.owners import canonical_posts


# The browser returns coordinates and structural labels as evidence. It never
# returns VERIFIED; visual approval is a separate validator action.
EXTRACT_JS = r"""() => {
  const root = document.querySelector('#main_pack') || document.querySelector('main') || document.body;
  const text = (document.body.innerText || '').slice(0, 40000);
  const blocked = /자동입력 방지|비정상적인 검색 요청|캡차를 입력|captcha|접근이 제한/i.test(text);
  if (blocked) return {blocked:true, reason:'Naver search restriction'};

  function canonical(href) {
    try {
      const url = new URL(href, location.href);
      if (!/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) return null;
      let match = url.pathname.match(/^\/([\w-]{2,40})\/(\d{5,20})(?:\/|$)/);
      if (match) return `https://blog.naver.com/${match[1].toLowerCase()}/${match[2]}`;
      if (/^\/PostView\.(naver|nhn)$/i.test(url.pathname)) {
        const id = url.searchParams.get('blogId'), log = url.searchParams.get('logNo');
        if (/^[\w-]{2,40}$/.test(id || '') && /^\d{5,20}$/.test(log || ''))
          return `https://blog.naver.com/${id.toLowerCase()}/${log}`;
      }
    } catch (_) {}
    return null;
  }
  function visible(element) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function isAd(element) {
    for (let node = element, i = 0; node && i < 8; node = node.parentElement, i++) {
      const marker = `${node.id || ''} ${String(node.className?.baseVal || node.className || '')}`;
      if (/(?:^|[\s_-])(ad_section|powerlink|sp_ad|ad_group|ad_item)(?:$|[\s_-])/i.test(marker)) return true;
    }
    return false;
  }
  function linksWithin(container) {
    const map = new Map();
    for (const anchor of container.querySelectorAll('a[href]')) {
      if (!visible(anchor) || isAd(anchor)) continue;
      const postUrl = canonical(anchor.href); if (!postUrl) continue;
      const rect = anchor.getBoundingClientRect();
      const row = {post_url:postUrl, x:Math.round(rect.left), y:Math.round(rect.top + scrollY)};
      if (!map.has(postUrl) || map.get(postUrl).y > row.y) map.set(postUrl, row);
    }
    return [...map.values()].sort((a,b) => a.y - b.y || a.x - b.x);
  }

  const articleRows = linksWithin(root);
  const headings = [...root.querySelectorAll('h1,h2,h3,h4,strong,[role="heading"],.title,.tit')]
    .filter(visible)
    .filter(node => /^(블로그|VIEW|블로그 인기글)$/i.test((node.textContent || '').trim()));
  const sectionCandidates = [];
  for (const heading of headings) {
    let best = null;
    for (let container = heading.parentElement, depth = 1; container && depth <= 7; container = container.parentElement, depth++) {
      const rows = linksWithin(container);
      if (!rows.length) continue;
      if (!best || rows.length < best.rows.length) best = {container, rows, depth};
      if (rows.length >= 10) break;
    }
    if (!best) continue;
    const rect = best.container.getBoundingClientRect();
    sectionCandidates.push({
      heading:(heading.textContent || '').trim(),
      depth:best.depth,
      bounds:{x:Math.round(rect.left),y:Math.round(rect.top+scrollY),width:Math.round(rect.width),height:Math.round(rect.height)},
      rows:best.rows.slice(0,10),
      total_posts:best.rows.length
    });
  }
  sectionCandidates.sort((a,b) => b.rows.length - a.rows.length || a.depth - b.depth || a.bounds.y - b.bounds.y);
  return {blocked:false, article_rows:articleRows.slice(0,10), article_total:articleRows.length,
    section:sectionCandidates[0] || null, section_candidate_count:sectionCandidates.length};
}"""


def _rows(raw_rows: object) -> list[dict]:
    if not isinstance(raw_rows, list):
        return []
    return canonical_posts(
        [row.get("post_url") for row in raw_rows if isinstance(row, dict)]
    )


def observations_from_browser(
    raw: dict,
    *,
    observed_at: str,
    source_url: str,
    evidence: dict,
) -> dict[str, dict]:
    """Convert browser output into two explicitly separate surface records."""

    common_evidence = {
        "source_url": source_url,
        "viewport": "390x844",
        **evidence,
    }
    if raw.get("blocked"):
        return {
            surface: make_observation(
                surface=surface,
                status="BLOCKED",
                observed_at=observed_at,
                evidence=common_evidence,
                reason=raw.get("reason", "Naver access restriction"),
                reason_code="ACCESS_RESTRICTION",
            )
            for surface in (SURFACE_SECTION, SURFACE_ARTICLES)
        }

    article_rows = _rows(raw.get("article_rows"))
    article_status = "CANDIDATE" if len(article_rows) == 10 else "PARTIAL"
    article = make_observation(
        surface=SURFACE_ARTICLES,
        status=article_status,
        observed_at=observed_at,
        results=article_rows,
        evidence={
            **common_evidence,
            "verification_method": "rendered_article_visual_order",
            "observed_distinct_posts": int(raw.get("article_total") or len(article_rows)),
        },
        reason=(
            "모바일 통합검색 전체에서 보이는 네이버 블로그 게시글 10개 후보"
            if len(article_rows) == 10
            else "모바일 통합검색에서 블로그 게시글 후보를 10개 미만으로 관측"
        ),
        reason_code="ARTICLE_ORDER_ONLY",
    )

    raw_section = raw.get("section") if isinstance(raw.get("section"), dict) else None
    section_rows = _rows(raw_section.get("rows")) if raw_section else []
    if not raw_section:
        section_status = "UNKNOWN"
        reason = "명시적인 블로그 영역 경계를 찾지 못함"
        reason_code = "SECTION_NOT_PRESENT"
    elif len(section_rows) < 10:
        section_status = "PARTIAL"
        reason = "블로그 영역 후보에서 게시글을 10개 미만으로 관측"
        reason_code = "SECTION_PARTIAL"
    else:
        section_status = "CANDIDATE"
        reason = "블로그 영역 후보 10개를 찾았으나 시각 검수 전"
        reason_code = "VISUAL_AUDIT_REQUIRED"
    section = make_observation(
        surface=SURFACE_SECTION,
        status=section_status,
        observed_at=observed_at,
        results=section_rows,
        evidence={
            **common_evidence,
            "verification_method": "automated_section_candidate",
            "section_name": raw_section.get("heading", "") if raw_section else "",
            "section_bounds": raw_section.get("bounds") if raw_section else None,
            "section_candidate_count": int(raw.get("section_candidate_count") or 0),
        },
        reason=reason,
        reason_code=reason_code,
    )
    return {SURFACE_SECTION: section, SURFACE_ARTICLES: article}


def error_observations(*, observed_at: str, reason: str, source_url: str = "") -> dict[str, dict]:
    return {
        surface: make_observation(
            surface=surface,
            status="ERROR",
            observed_at=observed_at,
            evidence={"source_url": source_url, "viewport": "390x844"},
            reason=reason,
            reason_code="COLLECTION_ERROR",
        )
        for surface in (SURFACE_SECTION, SURFACE_ARTICLES)
    }

