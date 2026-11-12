from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from automation.extractor import observations_from_browser
from automation.models import (
    GROUPS,
    KST,
    SURFACE_ARTICLES,
    LOCAL_AUDIT_FLAGS,
    SURFACE_FEED,
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
        "verification_method": "automated_feed_crosscheck",
        "screenshot_sha256": "a" * 64,
        "feed_audit": {
            "order_consistent": True,
            "non_overlapping": True,
            "no_excluded_cards": True,
            "post_unique": True,
        },
    }
    rows = (
        [{"post_url": row["post_url"], "feed_rank": row["rank"] * 2 - 1} for row in canonical_posts(urls)]
        if status not in {"UNKNOWN", "BLOCKED", "ERROR"}
        else []
    )
    return make_observation(
        surface=SURFACE_FEED,
        status=status,
        observed_at=(NOW - timedelta(minutes=minutes_old)).isoformat(),
        results=rows,
        evidence=evidence,
    )


def run_queries(default_status: str = "UNKNOWN") -> dict[str, dict]:
    return {
        query: {"query": query, "surfaces": {SURFACE_FEED: observation([], status=default_status)}}
        for variants in GROUPS.values()
        for query in variants
    }


def set_group(queries: dict, keyword: str, urls: list[str], status: str = "VERIFIED") -> None:
    for query in GROUPS[keyword]:
        queries[query] = {
            "query": query,
            "surfaces": {SURFACE_FEED: observation(urls, status=status)},
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
        self.assertEqual(surfaces[SURFACE_FEED]["status"], "PARTIAL")

    def test_feed_cards_verified_only_with_ten_blog_cards_and_passing_audit(self):
        cards = [
            {"feed_rank": 1 + index + (index > 2), "kind": "blog", "post_url": url}
            for index, url in enumerate(ten())
        ]
        audit = {flag: True for flag in ("order_consistent", "non_overlapping", "no_excluded_cards", "post_unique")}
        raw = {
            "blocked": False, "article_rows": cards, "article_total": 10, "section": None,
            "feed_layout": "per_post_cards", "feed_cards": cards, "feed_audit": audit,
        }
        kwargs = dict(
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            evidence={"screenshot_sha256": "d" * 64},
        )
        feed = observations_from_browser(raw, **kwargs)[SURFACE_FEED]
        self.assertEqual(feed["status"], "VERIFIED")
        self.assertEqual(validate_observation(feed), [])
        self.assertEqual(feed["results"][3]["rank"], 4)
        self.assertEqual(feed["results"][3]["feed_rank"], 5)
        self.assertEqual(feed["evidence"]["verification_method"], "automated_feed_crosscheck")

        failed = dict(raw, feed_audit={**audit, "order_consistent": False})
        self.assertEqual(observations_from_browser(failed, **kwargs)[SURFACE_FEED]["status"], "CANDIDATE")
        few = dict(raw, feed_cards=cards[:9])
        partial = observations_from_browser(few, **kwargs)[SURFACE_FEED]
        self.assertEqual(partial["status"], "PARTIAL")
        self.assertEqual(validate_observation(partial), [])
        unknown = dict(raw, feed_layout="unstructured")
        self.assertEqual(observations_from_browser(unknown, **kwargs)[SURFACE_FEED]["status"], "UNKNOWN")
        no_shot = observations_from_browser(raw, observed_at=NOW.isoformat(), source_url="x", evidence={})
        self.assertEqual(no_shot[SURFACE_FEED]["status"], "CANDIDATE")

    def test_local_headed_verification_requires_every_screen_flag(self):
        cards = [
            {"feed_rank": 1 + index, "kind": "blog", "post_url": url, "title": f"title {index}"}
            for index, url in enumerate(ten())
        ]
        audit = {flag: True for flag in ("order_consistent", "non_overlapping", "no_excluded_cards", "post_unique")}
        raw = {
            "blocked": False, "article_rows": cards, "article_total": 10, "section": None,
            "feed_layout": "per_post_cards", "feed_cards": cards, "feed_audit": audit,
        }
        flags = {flag: True for flag in LOCAL_AUDIT_FLAGS}
        kwargs = dict(
            observed_at=NOW.isoformat(),
            source_url="https://m.search.naver.com/search.naver?query=x",
            evidence={"screenshot_sha256": "f" * 64},
        )
        ok = observations_from_browser(raw, local_audit=flags, **kwargs)[SURFACE_FEED]
        self.assertEqual(ok["status"], "VERIFIED")
        self.assertEqual(validate_observation(ok), [])
        self.assertEqual(ok["results"][0]["title"], "title 0")
        for flag in LOCAL_AUDIT_FLAGS:
            broken = observations_from_browser(raw, local_audit={**flags, flag: False}, **kwargs)[SURFACE_FEED]
            self.assertEqual(broken["status"], "CANDIDATE", flag)
            self.assertIn(flag, broken["reason"])
        forged = dict(ok, evidence={**ok["evidence"], "feed_audit": {**ok["evidence"]["feed_audit"], "screen_hit_test": False}})
        self.assertTrue(validate_observation(forged))

    def test_failed_local_check_holds_assignment(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((1, "esim99_")))
        set_group(queries, "다이소 유심", ten((1, "ntelecom59")))
        queries["바로유심"]["surfaces"][SURFACE_FEED] = observation(ten(), status="CANDIDATE")
        groups = aggregate_groups(queries, at=NOW)
        self.assertFalse(groups["KT바로유심"]["complete"])
        self.assertEqual(groups["KT바로유심"]["missing"], [])
        self.assertTrue(groups["다이소 유심"]["complete"])

    def test_old_section_verified_is_not_used_as_feed_metric(self):
        queries = run_queries()
        for query in GROUPS["KT바로유심"]:
            queries[query] = {"query": query, "surfaces": {SURFACE_SECTION: manual_verified_observation(
                urls=ten((1, "esim99_")), observed_at=NOW.isoformat(),
                source_url="https://m.search.naver.com/search.naver?query=x",
                screenshot_sha256="c" * 64, reviewed_by="operator")}}
        groups = aggregate_groups(queries, at=NOW)
        self.assertFalse(groups["KT바로유심"]["complete"])
        self.assertEqual(recommend(groups, at=NOW)["status"], "PENDING")

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
    def test_single_verified_keyword_assigns_all_four_with_unique_titles(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["unassigned"], [])
        self.assertEqual(len(result["assignments"]), 1)
        assignment = result["assignments"][0]
        self.assertEqual(assignment["keyword"], "KT바로유심")
        self.assertEqual(assignment["people"], ["건호", "영은", "하루", "수진"])
        self.assertEqual(len({x["title"] for x in assignment["titles"]}), 4)
        self.assertIn("상위 10개", assignment["owner_reasons"]["건호"])
        self.assertIn("상위권", assignment["owner_reasons"]["영은"])

    def test_two_verified_keywords_distribute_all_four_without_duplicates(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        set_group(queries, "LG모두의 원칩", ten((2, "carrotmobile_"), (8, "jjuny1253")))
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        teams = {row["keyword"]: row["people"] for row in result["assignments"]}
        self.assertEqual(teams["KT바로유심"], ["건호", "수진"])
        self.assertEqual(teams["LG모두의 원칩"], ["영은", "하루"])
        self.assertEqual(len({person for team in teams.values() for person in team}), 4)
        self.assertEqual(result["status"], "READY")

    def test_owner_specific_priorities_match_local_serp_scenario(self):
        groups = {}
        for keyword in GROUPS:
            groups[keyword] = {
                "complete": True, "status": "VERIFIED", "queries": list(GROUPS[keyword]),
                "missing": [], "matches": {
                    person: [{"query": GROUPS[keyword][0], "rank": 2}]
                    for person in ("건호", "영은", "하루", "수진")
                },
            }
        # All four appear in KT, but 건호 barely holds 10th in one variant.
        groups["KT바로유심"]["matches"]["건호"] = [
            {"query": "바로유심", "rank": 10}
        ]
        # 하루 is absent from all three LG variants.
        groups["LG모두의 원칩"]["matches"]["하루"] = []
        groups["LG모두의 원칩"]["missing"] = ["하루"]
        # 영은 and 수진 are absent from all three Daiso variants.
        for owner in ("영은", "수진"):
            groups["다이소 유심"]["matches"][owner] = []
        groups["다이소 유심"]["missing"] = ["영은", "수진"]
        # 수진 is also missing from Tablet, but Daiso needs two people.
        groups["태블릿소유자회원번호"]["matches"]["수진"] = []
        groups["태블릿소유자회원번호"]["missing"] = ["수진"]
        result = recommend(groups, at=NOW)
        by_owner = {owner: (item["keyword"], item["owner_reasons"][owner])
                    for item in result["assignments"] for owner in item["people"]}
        self.assertEqual(result["status"], "READY")
        self.assertEqual({k: v[0] for k, v in by_owner.items()}, {
            "건호": "KT바로유심", "영은": "다이소 유심",
            "하루": "LG모두의 원칩", "수진": "다이소 유심"
        })
        self.assertIn("10번째", by_owner["건호"][1])
        self.assertIn("상위 10개", by_owner["하루"][1])

    def test_each_author_gets_only_configured_blog_id_and_link(self):
        from automation.owners import PEOPLE
        queries = run_queries()
        set_group(queries, "KT바로유심",
                  ten((3, "esim99"), (7, "ntelecom59"), (10, "carrotmobile_")))
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        all_rows = [row for item in result["assignments"] for row in item["titles"]]
        self.assertEqual(len(all_rows), 4)
        for row in all_rows:
            self.assertIn(row["blog_id"], PEOPLE[row["owner"]])
            self.assertEqual(row["blog_url"], "https://blog.naver.com/" + row["blog_id"])
            self.assertTrue(row["blog_reason"])
        chosen = {row["owner"]: row["blog_id"] for row in all_rows}
        self.assertEqual(chosen["건호"], "lifeon5g_")  # weaker than carrotmobile_ at 10th
        self.assertEqual(chosen["하루"], "ntelecom59")
        self.assertEqual(chosen["수진"], "jjuny1253")

    def test_owner_blog_selection_prefers_weakest_global_presence_when_keyword_all_missing(self):
        from automation.scheduler import _choose_blog_id
        group_data = {
            "KT바로유심": {"complete": True, "status": "VERIFIED",
                            "queries": list(GROUPS["KT바로유심"]),
                            "matches": {"영은": [
                                {"blog_id": "esim99", "query": q, "rank": 3}
                                for q in GROUPS["KT바로유심"]]}},
            "LG모두의 원칩": {"complete": True, "status": "VERIFIED",
                              "queries": list(GROUPS["LG모두의 원칩"]),
                              "matches": {"영은": [
                                  {"blog_id": "esim99", "query": q, "rank": 4}
                                  for q in GROUPS["LG모두의 원칩"]] + [
                                  {"blog_id": "esim99_", "query": "모두의 원칩", "rank": 10},
                                  {"blog_id": "esim99_", "query": "LG모두의 원칩", "rank": 9}]}},
            "태블릿소유자회원번호": {"complete": True, "status": "VERIFIED",
                                      "queries": list(GROUPS["태블릿소유자회원번호"]),
                                      "matches": {"영은": [
                                          {"blog_id": "esim87_", "query": q, "rank": 6}
                                          for q in GROUPS["태블릿소유자회원번호"]]}},
            "다이소 유심": {"complete": True, "status": "VERIFIED",
                             "queries": list(GROUPS["다이소 유심"]),
                             "matches": {"영은": []}},
        }
        blog_id, reason = _choose_blog_id("영은", "다이소 유심", group_data, {})
        self.assertEqual(blog_id, "esim99_")
        self.assertIn("모두 이 키워드", reason)
        blog_id, _ = _choose_blog_id("영은", "다이소 유심", group_data, {("영은", "esim99_"): 2})
        self.assertEqual(blog_id, "esim87_")  # rotate an otherwise unexposed ID

    def test_no_blog_selection_when_serp_group_not_verified(self):
        queries = run_queries()
        set_group(queries, "다이소 유심", ten(), status="CANDIDATE")
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        self.assertFalse(result["assignments"])
        self.assertEqual(result["status"], "PENDING")

    def test_recent_recommendations_break_same_priority_ties(self):
        queries = run_queries()
        for key in ("KT바로유심", "LG모두의 원칩"):
            set_group(queries, key, ten())
        groups = aggregate_groups(queries, at=NOW)
        history = {"entries": [{"recommendation": {"assignments": [
            {"keyword": "KT바로유심", "people": ["건호", "영은", "하루", "수진"], "titles": []}
        ]}}]}
        result = recommend(groups, history=history, at=NOW)
        self.assertEqual({row["keyword"] for row in result["assignments"]}, {"LG모두의 원칩"})

    def test_weak_variants_do_not_become_missing_when_any_variant_is_visible(self):
        queries = run_queries()
        for q in GROUPS["KT바로유심"]:
            urls = ten((10, "carrotmobile_")) if q == "바로유심" else ten((4, "esim99"))
            queries[q] = {"query": q, "surfaces": {SURFACE_FEED: observation(urls)}}
        result = recommend(aggregate_groups(queries, at=NOW), at=NOW)
        assignment = result["assignments"][0]
        self.assertIn("건호", assignment["people"])
        self.assertIn("10번째", assignment["owner_reasons"]["건호"])
        self.assertEqual(result["status"], "READY")

    def test_one_unknown_variant_prevents_missing_and_assignment(self):
        queries = run_queries()
        set_group(queries, "KT바로유심", ten((3, "esim99_"), (7, "ntelecom59")))
        last = GROUPS["KT바로유심"][-1]
        queries[last] = {"query": last, "surfaces": {SURFACE_FEED: observation([], status="UNKNOWN")}}
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
                "surfaces": {SURFACE_FEED: observation(ten((4, "esim99_")), minutes_old=180)},
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
