"""User-initiated, rate-limited Naver SERP evidence collection on Windows.

Only visits public Naver search-result pages. Never bypasses a CAPTCHA,
access restriction, or robots controls. No downstream page fetching.
Search access and results remain subject to Naver's applicable terms.
"""
from __future__ import annotations

import json
import re
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from urllib.parse import urlencode

KST = timezone(timedelta(hours=9))
MAX_KEYWORDS = 10
MAX_KEYWORD_LENGTH = 80
DELAY_SECONDS = 6.0
STOP_PHRASES = ("자동입력 방지", "비정상적인 검색 요청", "캡차를 입력", "CAPTCHA")
MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
)


class CollectionBlocked(RuntimeError):
    """A search access restriction was seen; stop the entire run."""


class CollectionCancelled(RuntimeError):
    """The user stopped the current run."""


def validate_inputs(keywords: object, devices: object) -> tuple[list[str], list[str]]:
    if not isinstance(keywords, (list, tuple)) or not isinstance(devices, (list, tuple)):
        raise ValueError("검색어 및 기기 목록이 올바르지 않습니다.")
    result = []
    seen = set()
    for word in keywords:
        if not isinstance(word, str):
            raise ValueError("검색어는 문자열이어야 합니다.")
        clean = " ".join(word.split())
        if not clean:
            continue
        if len(clean) > MAX_KEYWORD_LENGTH or any(ord(c) < 32 for c in clean):
            raise ValueError(f"검색어는 {MAX_KEYWORD_LENGTH}자 이하여야 합니다.")
        if clean not in seen:
            result.append(clean)
            seen.add(clean)
    if not result:
        raise ValueError("검색어를 최소 1개 입력하세요.")
    if len(result) > MAX_KEYWORDS:
        raise ValueError(f"한 번에 최대 {MAX_KEYWORDS}개 검색어를 수집할 수 있습니다.")
    modes = list(dict.fromkeys(devices))
    if not modes or any(mode not in {"pc", "mo"} for mode in modes):
        raise ValueError("PC 또는 모바일 모드를 하나 이상 선택하세요.")
    return result, modes


def file_keyword(keyword: str) -> str:
    """Produce a Windows-safe filename that remains recognizable for SERP Lens."""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", keyword)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value[:MAX_KEYWORD_LENGTH].rstrip(" .") or "검색어")


def default_root() -> Path:
    return Path.home() / "Documents" / "SERP-Lens" / "runs"


def new_run_dir(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    base = datetime.now(KST).strftime("%Y%m%d-%H%M%S")
    folder = root / base
    for n in range(100):
        candidate = folder if n == 0 else root / f"{base}-{n:02d}"
        try:
            candidate.mkdir(exist_ok=False)
            return candidate
        except FileExistsError:
            pass
    raise OSError("수집 결과 폴더를 생성할 수 없습니다.")


def _check_stop(stop: Event) -> None:
    if stop.is_set():
        raise CollectionCancelled("사용자가 수집을 중지했습니다.")


def _load_and_capture(browser, keyword: str, device: str, folder: Path, stop: Event) -> tuple[str, str]:
    context_kwargs = {"locale": "ko-KR", "viewport": {"width": 1366, "height": 900}}
    if device == "mo":
        context_kwargs.update({
            "user_agent": MOBILE_UA,
            "viewport": {"width": 390, "height": 844},
            "device_scale_factor": 2,
            "is_mobile": True,
            "has_touch": True,
        })
    context = browser.new_context(**context_kwargs)
    page = context.new_page()
    try:
        site = "https://m.search.naver.com/search.naver" if device == "mo" else "https://search.naver.com/search.naver"
        url = site + "?" + urlencode({"query": keyword})
        page.goto(url, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(1400)
        _check_stop(stop)
        visible = page.locator("body").inner_text(timeout=5000)
        if any(phrase.casefold() in visible.casefold() for phrase in STOP_PHRASES):
            raise CollectionBlocked("네이버 자동입력 방지/접근 제한 화면이 나타나 수집을 중단했습니다.")
        # A limited number of ordinary scrolls to allow lazy-loaded cards to render.
        for _ in range(4):
            _check_stop(stop)
            page.mouse.wheel(0, 1200)
            page.wait_for_timeout(450)
        page.wait_for_timeout(400)
        visible = page.locator("body").inner_text(timeout=5000)
        if any(phrase.casefold() in visible.casefold() for phrase in STOP_PHRASES):
            raise CollectionBlocked("네이버 접근 제한 화면이 나타나 수집을 중단했습니다.")
        stamp = datetime.now(KST).strftime("%Y%m%d-%H%M")
        stem = f"{stamp}_{device}_{file_keyword(keyword)}"
        # Avoid overwriting results if the same minute/name is used again.
        index = 1
        while (folder / f"{stem}.html").exists():
            stem = f"{stamp}_{device}_{file_keyword(keyword)}_{index}"
            index += 1
        html_path = folder / f"{stem}.html"
        png_path = folder / f"{stem}.png"
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(png_path), full_page=True, animations="disabled", timeout=25000)
        return html_path.name, png_path.name
    finally:
        context.close()


def collect(keywords: list[str], devices: list[str], folder: Path, stop: Event, notify) -> dict:
    """Run in a background thread; notify(status, progress, total, message)."""
    words, modes = validate_inputs(keywords, devices)
    total = len(words) * len(modes)
    records: list[dict] = []
    completed = 0
    state = "completed"
    note = "수집 완료"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        # Deferred import: web-only users are not required to install Playwright.
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            # Use the installed Microsoft Edge; don't bundle/automatically download a browser.
            browser = playwright.chromium.launch(channel="msedge", headless=False)
            try:
                for word in words:
                    for mode in modes:
                        _check_stop(stop)
                        if completed > 0 and stop.wait(DELAY_SECONDS):
                            raise CollectionCancelled("사용자가 수집을 중지했습니다.")
                        notify("running", completed, total, f"{mode.upper()} · {word} 검색 중")
                        html, png = _load_and_capture(browser, word, mode, folder, stop)
                        records.append({"keyword": word, "device": mode, "html": html, "png": png})
                        completed += 1
                        notify("running", completed, total, f"{completed}/{total} 화면 저장 완료")
            finally:
                browser.close()
    except CollectionCancelled as exc:
        state, note = "cancelled", str(exc)
    except CollectionBlocked as exc:
        state, note = "blocked", str(exc)
    except Exception as exc:
        state, note = "error", f"수집 실패: {type(exc).__name__}: {exc}"
    manifest = {
        "version": "1.2.0-beta", "created_at_kst": datetime.now(KST).isoformat(),
        "status": state, "message": note, "requested": total,
        "saved": len(records), "records": records,
        "note": "PC는 데스크톱 Edge, 모바일은 모바일 브라우저 에뮬레이션. 화면 검증 필요.",
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if records:
        # Portable evidence archive for independent, offline analysis.
        with zipfile.ZipFile(folder / "serp_evidence.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
            archive.write(folder / "manifest.json", "manifest.json")
            for row in records:
                for key in ("html", "png"):
                    archive.write(folder / row[key], row[key])
    notify(state, completed, total, note)
    return manifest
