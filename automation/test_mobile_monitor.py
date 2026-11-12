from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from automation.extractor import observations_from_browser
from automation.models import (
    GROUPS,
    KST,
    SURFACE_ARTICLES,
    SURFACE_SECTION,
    effective_status,
    make_observation,
    validate_observation,
)
from automation.owners import canonical_posts, owner_matches, parse_blog_post
from automation.scheduler import aggregate_groups, recommend
from automation.storage import merge_histories
from automation.verify import manual_verified_observation


NOW = datetime(2026, 11, 12, 11, 30, tzinfo=KST)


def ten(*placements: tuple[int, str]) -> list[str]:
    rows = [f"https://blog.naver.com/external_{index}/{224000000000 + index}" for index in range(10)]
    for rank, blog_id in placements:
        rows[rank - 1] = f"https://m.blog.naver.com/{blog_id}/{224100000000 + rank}"
    return rows


def observation(urls: list[str], *, status: str = "VERIFIED", minutes_old: int = 0) -> dict:
    evidence = {
        "source_url": "https://m.search.naver.com/search.naver?query=test",
        "viewport": "390x844",
        "verification_method": "human_visual_review",
        "section_name": "블로그",
        "screenshot_sha256": "a" * 64,
        "reviewed_by": "test-reviewer",
    }
    return make_observation(
        surface=SURFACE_SECTION,
        status=status,
        observed_at=(NOW - timedelta(minutes=minutes_old)).isoformat(),
        results=canonical_posts(urls) if status not in {"UNKNOWN", "BLOCKED", "ERROR"} else [],
        evidence=evidence,
    )


def run_queries(default_status: str = "UNKNOWN") -> dict[str, dict]:
    return {
        query: {"query": query, "surfaces": {SURFACE_SECTION: observation([], status=default_status)}}
        for variants in GROUPS.values()
        for query in variants
    }


def set_group(queries: dict, keyword: str, urls: list[str], status: str = "VERIFIED") -> None:
    for query in GROUPS[keyword]:
        queries[query] = {
            "query": query,
            "surfaces": {SURFACE_SECTION: observation(urls, status=status)},
        }


class OwnerTests(unittest.TestCase):
    def test_all_seven_ids_match_configured_people(self):
        rows = canonical_posts(
            ten((1, "esim99_"), (2, "esim99"), (3, "esim87_"), (4, "carrotmobile_"),
                (5, "lifeon5g_"), (6, "ntelecom59"), (7, "jjuny1253"))
        )
        matches = owner_matches(rows)
        self.assertEqual([row["rank"] for row in matches["영은"]], [1, 2, 3])
        self.assertEqual([row["rank"] for row in matches["건호"]], [4, 5])
        self.assertEqual(matches["하루"][0]["rank"], 6)
        self.assertEqual(matches["수진"][0]["rank"], 7)

    def test_posts_only_profiles_and_lookalike_hosts_rejected(self):
        self.assertIsNone(parse_blog_post("https://blog.naver.com/esim99_"))
        self.assertIsNone(parse_blog_post("https://phishing.test/blog.naver.com/esim99_/224000000000"))
        self.assertIsNone(parse_blog_post("https://cafe.naver.com/esim99_/224000000000"))
        post = parse_blog_post(
            "https://blog.naver.com/PostView.naver?blogId=jjuny1253&logNo=224465701947"
        )
        self.assertEqual(post["owner"], "수진")

    def test_duplicate_posts_and_non_blog_links_are_filtered(self):
        urls = [
            "https://blog.naver.com/esim99_/224000000001",
            "https://m.blog.naver.com/esim99_/224000000001",
            "https://cafe.naver.com/demo/224000000002",
            "https://ads.example/offer",
            "https://blog.naver.com/external/224000000003",
        ]
        rows = canonical_posts(urls)
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["rank"] for row in rows], [1, 2])


class EvidenceTests(unittest.TestCase):
    def test_article_order_ten_is_candidate_not_verified_section(self):
        raw = {
            "blocked": False,
            "article_rows": [{"post_url": url} for url in ten()],
            "article_total": 12,
            "section": None,
        }
        surfaces = observations_from_browser(
            raw,
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            evidence={"screenshot_sha256": "b" * 64},
        )
        self.assertEqual(surfaces[SURFACE_ARTICLES]["status"], "CANDIDATE")
        self.assertEqual(surfaces[SURFACE_SECTION]["status"], "UNKNOWN")

    def test_per_post_card_feed_explains_missing_section_without_substituting_rank(self):
        raw = {
            "blocked": False,
            "article_rows": [{"post_url": url} for url in ten()],
            "article_total": 16,
            "section": None,
            "feed_layout": "per_post_cards",
            "feed_interleaved_cafe_cards": 3,
        }
        surfaces = observations_from_browser(
            raw,
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            evidence={},
        )
        section = surfaces[SURFACE_SECTION]
        self.assertEqual(section["status"], "UNKNOWN")
        self.assertEqual(section["reason_code"], "SECTION_NOT_PRESENT")
        self.assertEqual(section["results"], [])
        article = surfaces[SURFACE_ARTICLES]
        self.assertEqual(article["status"], "CANDIDATE")
        self.assertEqual(article["evidence"]["feed_layout"], "per_post_cards")
        self.assertEqual(article["evidence"]["feed_interleaved_cafe_cards"], 3)

    def test_verified_requires_visual_audit_fields(self):
        invalid = make_observation(
            surface=SURFACE_SECTION,
            status="VERIFIED",
            observed_at=NOW.isoformat(),
            results=canonical_posts(ten()),
            evidence={"verification_method": "automated_section_candidate"},
        )
        self.assertTrue(validate_observation(invalid))
        valid = manual_verified_observation(
            urls=ten(),
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            screenshot_sha256="c" * 64,
            reviewed_by="operator",
        )
        self.assertEqual(validate_observation(valid), [])

    def test_blocked_marks_both_surfaces_and_stops_rank_output(self):
        surfaces = observations_from_browser(
            {"blocked": True, "reason": "captcha"},
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            evidence={},
        )
        self.assertEqual({row["status"] for row in surfaces.values()}, {"BLOCKED"})
        self.assertTrue(all(not row["results"] for row in surfaces.values()))

    def test_older_than_45_minutes_is_stale(self):
        old = observation(ten(), minutes_old=46)
        self.assertEqual(effective_status(old, NOW), "STALE")
        self.assertEqual(effective_status(observation(ten(), minutes_old=45), NOW), "VERIFIED")


class SchedulerTests(unittest.TestCase):
    def test_sample_verified_ranks_recommend_geonho_and_sujin_with_unique_titles(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        groups = aggregate_groups(queries, at=NOW)
        result = recommend(groups, at=NOW)
        assignment = result["assignments"][0]
        self.assertEqual(assignment["keyword"], "KT바로유심")
        self.assertEqual(assignment["people"], ["건호", "수진"])
        self.assertEqual(len({row["title"] for row in assignment["titles"]}), 2)
        self.assertNotEqual(assignment["titles"][0]["intent"], assignment["titles"][1]["intent"])

    def test_two_keywords_create_two_non_overlapping_teams(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        set_group(queries, "LG모두의 원칩", ten((2, "carrotmobile_"), (8, "jjuny1253")))
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        teams = {row["keyword"]: row["people"] for row in result["assignments"]}
        self.assertEqual(teams["KT바로유심"], ["건호", "수진"])
        self.assertEqual(teams["LG모두의 원칩"], ["영은", "하루"])
        self.assertEqual(len({person for team in teams.values() for person in team}), 4)

    def test_one_unknown_variant_prevents_missing_and_assignment(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        last = GROUPS["KT바로유심"][-1]
        queries[last] = {"query": last, "surfaces": {SURFACE_SECTION: observation([], status="UNKNOWN")}}
        groups = aggregate_groups(queries, at=NOW)
        self.assertFalse(groups["KT바로유심"]["complete"])
        self.assertEqual(groups["KT바로유심"]["missing"], [])
        self.assertEqual(set(groups["KT바로유심"]["owner_states"].values()), {"UNKNOWN"})
        self.assertEqual(recommend(groups, at=NOW)["assignments"], [])

    def test_unknown_current_does_not_create_exit(self):
        before = run_queries()
        set_group(before, "KT바로유심", ten((4, "esim99_")))
        current = run_queries()
        groups = aggregate_groups(current, {"queries": before}, at=NOW)
        self.assertEqual(groups["KT바로유심"]["exits"], [])

    def test_verified_to_verified_missing_creates_exit(self):
        before = run_queries()
        current = run_queries()
        for query in GROUPS["KT바로유심"]:
            before[query] = {
                "query": query,
                "surfaces": {SURFACE_SECTION: observation(ten((4, "esim99_")), minutes_old=180)},
            }
        set_group(current, "KT바로유심", ten())
        groups = aggregate_groups(current, {"queries": before}, at=NOW)
        exits = groups["KT바로유심"]["exits"]
        self.assertEqual(len(exits), 3)
        self.assertTrue(all(row["owner"] == "영은" and row["previous_ranks"] == [4] for row in exits))


class StorageTests(unittest.TestCase):
    def test_concurrent_and_retry_histories_are_union_and_deduplicated(self):
        one = {"schema": "naver-blog-ops-history-v2", "entries": [{"run_id": "a", "at": "1"}]}
        two = {"schema": "naver-blog-ops-history-v2", "entries": [
            {"run_id": "a", "at": "1"}, {"run_id": "b", "at": "2"}
        ]}
        merged = merge_histories(one, two, two)
        self.assertEqual([row["run_id"] for row in merged["entries"]], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
