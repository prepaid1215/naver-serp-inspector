"""Screen-level cross-check for the Windows headed-browser collector.

Extraction reads the DOM. This module compares that result with what is
actually painted: the topmost element at each blog card's on-screen position,
the visible title text, the scroll order, and the saved full-page screenshot.
Any failed flag keeps the observation below VERIFIED, which holds assignment.
"""
from __future__ import annotations

from pathlib import Path

from automation.models import LOCAL_AUDIT_FLAGS


DEVICE_SCALE = 2
TOP_CARDS = 10

# Runs in the page. `expected` is [{post_url, feed_rank, title}] in feed order.
HIT_TEST_JS = r"""async (expected) => {
  function canonical(href) {
    try {
      const url = new URL(href, location.href);
      if (!/^(m\.)?blog\.naver\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/([\w-]{2,40})\/(\d{5,20})(?:\/|$)/);
      if (match) return `https://blog.naver.com/${match[1].toLowerCase()}/${match[2]}`;
      if (/^\/PostView\.(naver|nhn)$/i.test(url.pathname)) {
        const id = url.searchParams.get('blogId'), log = url.searchParams.get('logNo');
        if (id && log) return `https://blog.naver.com/${id.toLowerCase()}/${log}`;
      }
    } catch (_) {}
    return null;
  }
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const results = [];
  let previousTop = -1;
  for (const item of expected) {
    const anchors = [...document.querySelectorAll('a[href]')].filter(a => canonical(a.href) === item.post_url);
    const sizeOf = a => ((a.innerText || '').trim().length > 3 ? parseFloat(getComputedStyle(a).fontSize) || 0 : 0);
    const anchor = anchors.sort((a, b) => sizeOf(b) - sizeOf(a))[0];
    const out = {post_url: item.post_url, hit: false, order: false, title: false};
    if (anchor) {
      anchor.scrollIntoView({block: 'center'});
      await frame();
      const rect = anchor.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 120), 1), innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      const hitAnchor = top && top.closest('a[href]');
      out.hit = !!hitAnchor && canonical(hitAnchor.href) === item.post_url;
      const absoluteTop = Math.round(rect.top + scrollY);
      out.order = absoluteTop > previousTop;
      previousTop = absoluteTop;
      const shown = ((hitAnchor && hitAnchor.innerText) || '').replace(/\s+/g, ' ').trim();
      const wanted = String(item.title || '').replace(/\s+/g, ' ').trim();
      out.title = !!wanted && shown.length > 0 && (shown.startsWith(wanted.slice(0, 15)) || wanted.startsWith(shown.slice(0, 15)));
    }
    results.push(out);
  }
  window.scrollTo(0, 0);
  await frame();
  return {results, scroll_height: document.documentElement.scrollHeight, inner_width: innerWidth};
}"""


def blog_cards(raw: dict, limit: int = TOP_CARDS) -> list[dict]:
    cards = [
        card for card in (raw.get("feed_cards") or [])
        if isinstance(card, dict) and card.get("kind") == "blog" and card.get("post_url")
    ]
    return cards[:limit]


def screenshot_checks(
    path: Path, cards: list[dict], *, scroll_heights: tuple[int, ...], scale: int = DEVICE_SCALE
) -> dict:
    """Compare the saved PNG with the layout the extractor measured."""

    from PIL import Image, ImageStat

    Image.MAX_IMAGE_PIXELS = None
    with Image.open(path) as image:
        width, height = image.size
        # The page may lengthen while it is captured, so accept the height measured
        # just before or just after the screenshot.
        size_ok = width > 0 and any(
            abs(height - measured * scale) <= 4 * scale for measured in scroll_heights if measured
        )
        nonblank = bool(cards)
        for card in cards:
            top = int(card.get("y", 0)) * scale
            bottom = top + int(card.get("height", 0)) * scale
            if top < 0 or bottom > height or bottom - top < 40 * scale:
                nonblank = False
                break
            crop = image.crop((0, top, width, bottom)).convert("L")
            if ImageStat.Stat(crop).stddev[0] < 8:
                nonblank = False
                break
    return {"screenshot_size_matches": size_ok, "screenshot_crops_nonblank": nonblank}


def stable_rerun(first: dict, second: dict, limit: int = TOP_CARDS) -> bool:
    def urls(raw: dict) -> list[str]:
        return [card["post_url"] for card in blog_cards(raw, limit)]

    return bool(urls(first)) and urls(first) == urls(second)


def run_local_checks(
    page, raw: dict, screenshot: Path, rerun: dict, heights: tuple[int, ...] = ()
) -> dict:
    """Return the LOCAL_AUDIT_FLAGS plus human-readable counts."""

    cards = blog_cards(raw)
    flags = {flag: False for flag in LOCAL_AUDIT_FLAGS}
    flags["checked_cards"] = len(cards)
    if len(cards) < TOP_CARDS:
        return flags
    probe = page.evaluate(
        HIT_TEST_JS,
        [{"post_url": c["post_url"], "feed_rank": c.get("feed_rank"), "title": c.get("title", "")} for c in cards],
    )
    rows = probe.get("results", [])
    flags["screen_hit_test"] = len(rows) == len(cards) and all(r["hit"] for r in rows)
    flags["screen_order"] = len(rows) == len(cards) and all(r["order"] for r in rows)
    flags["title_matches_screen"] = len(rows) == len(cards) and all(r["title"] for r in rows)
    flags.update(screenshot_checks(screenshot, cards, scroll_heights=heights or (int(probe.get("scroll_height") or 0),)))
    flags["stable_rerun"] = stable_rerun(raw, rerun)
    return flags
