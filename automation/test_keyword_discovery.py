"""Keyword expansion, visible related-search candidates and gated approvals."""
from __future__ import annotations
import unittest

from automation.models import BASE_GROUPS, GROUPS
from automation.related_keywords import normalized_query, related_from_page, aggregate_related_candidates
from automation.approve_keyword_issue import approve_issue


class KeywordExpansionTests(unittest.TestCase):
    def test_eight_baseline_groups_each_have_three_variants(self):
        self.assertEqual(len(BASE_GROUPS), 8)
        self.assertTrue(all(len(phrases) == 3 for phrases in BASE_GROUPS.values()))
        self.assertEqual(len({p for values in BASE_GROUPS.values() for p in values}), 24)
        for group in BASE_GROUPS:
            self.assertIn(group, GROUPS)

    def test_related_candidates_are_observed_not_auto_added(self):
        terms = related_from_page(["KT바로유심", "KT 바로유심 구매", " KT  바로유심   구매 ",
                                   "편의점 바로유심", "x", "", "서울"], "KT바로유심")
        self.assertEqual(terms, ["KT 바로유심 구매", "편의점 바로유심", "서울"])
        records = {
            "KT바로유심": {"related_queries": terms},
            "바로유심": {"related_queries": ["KT 바로유심 구매", "바로유심", "다이소 유심"]},
        }
        proposed = aggregate_related_candidates(records)
        self.assertEqual({row["query"] for row in proposed}, {"KT 바로유심 구매", "편의점 바로유심", "서울"})
        self.assertEqual(proposed[0]["sources"], ["KT바로유심", "바로유심"])
        self.assertEqual(proposed[0]["status"], "PROPOSED")
        self.assertNotIn("다이소 유심", [row["query"] for row in proposed])

    def test_no_unverified_related_terms(self):
        self.assertEqual(related_from_page(None, "선불폰 개통"), [])
        self.assertEqual(normalized_query("a"), "")
        self.assertEqual(normalized_query(" " * 20), "")

    def test_issue_requires_maintainer_label_and_known_group(self):
        issue = {"action": "labeled", "label": {"name": "serp-approved"},
                 "issue": {"body": "group: 편의점 선불유심\nquery: GS25 선불유심"}}
        doc, status = approve_issue(issue, {"groups": {}})
        self.assertEqual(status, "approved")
        self.assertEqual(doc["groups"]["편의점 선불유심"], ["GS25 선불유심"])
        same, status = approve_issue(issue, doc)
        self.assertEqual(status, "already-approved")
        self.assertEqual(same, doc)
        with self.assertRaises(ValueError):
            approve_issue({**issue, "label": {"name": "awaiting-review"}}, {"groups": {}})
        with self.assertRaises(ValueError):
            approve_issue({**issue, "issue": {"body": "group: not-a-group\nquery: GS25 선불유심"}}, {"groups": {}})

    def test_baseline_keyword_will_not_be_duplicated(self):
        issue = {"action": "labeled", "label": {"name": "serp-approved"},
                 "issue": {"body": "group: KT바로유심\nquery: 다이소 유심"}}
        doc, status = approve_issue(issue, {"groups": {}})
        self.assertEqual(status, "already-baseline")


if __name__ == "__main__":
    unittest.main()
