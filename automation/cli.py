"""Command-line entry points for collection, validation, replay, and fallback."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from automation.collector import DATA_DIR, EVIDENCE_DIR, collect_all
from automation.models import (
    SCHEMA,
    DECISION_SURFACE,
    SURFACE_SECTION,
    migrate_legacy_run,
    parse_time,
    validate_run,
)
from automation.scheduler import aggregate_groups, recommend
from automation.storage import (
    append_run,
    atomic_write_json,
    merge_histories,
    normalize_history,
    read_json,
)
from automation.verify import manual_verified_observation


def _load(path: Path):
    value = read_json(path, None)
    if value is None:
        raise SystemExit(f"JSON 파일을 읽을 수 없습니다: {path}")
    return value


def command_collect(args) -> int:
    collect_all(
        data_dir=args.data_dir,
        evidence_root=args.evidence_dir,
        delay_seconds=args.delay,
    )
    return 0


def command_validate(args) -> int:
    value = _load(args.input)
    errors = validate_run(value)
    if errors:
        for message in errors:
            print("ERROR", message)
        return 1
    counts: dict[str, int] = {}
    for record in value["queries"].values():
        status = record["surfaces"][DECISION_SURFACE]["status"]
        counts[status] = counts.get(status, 0) + 1
    print("VALID", value["run_id"], counts)
    return 0


def command_migrate(args) -> int:
    legacy = _load(args.input)
    run = legacy if legacy.get("schema") == SCHEMA else migrate_legacy_run(legacy)
    at = parse_time(run["captured_at_kst"])
    run["groups"] = aggregate_groups(run["queries"], at=at)
    run["recommendation"] = recommend(run["groups"], at=at)
    errors = validate_run(run)
    if errors:
        raise SystemExit("migrated data invalid: " + "; ".join(errors))
    atomic_write_json(args.output, run)
    return 0


def command_manual_verify(args) -> int:
    payload = _load(args.evidence)
    latest = _load(args.latest)
    if latest.get("schema") != SCHEMA:
        latest = migrate_legacy_run(latest)
    query = payload.get("query")
    if query not in latest.get("queries", {}):
        raise SystemExit("latest.json에 없는 검색어입니다.")
    observation = manual_verified_observation(
        urls=payload.get("urls") or [],
        observed_at=payload.get("observed_at", ""),
        source_url=payload.get("source_url", ""),
        screenshot_sha256=payload.get("screenshot_sha256", ""),
        reviewed_by=payload.get("reviewed_by", ""),
        section_name=payload.get("section_name", "블로그"),
        review_note=payload.get("review_note", ""),
    )
    latest["queries"][query]["surfaces"][SURFACE_SECTION] = observation
    at = parse_time(latest.get("captured_at_kst"))
    latest["groups"] = aggregate_groups(latest["queries"], at=at)
    history = normalize_history(read_json(args.history, []))
    latest["recommendation"] = recommend(latest["groups"], history=history, at=at)
    errors = validate_run(latest)
    if errors:
        raise SystemExit("updated data invalid: " + "; ".join(errors))
    history = append_run(history, latest)
    atomic_write_json(args.latest, latest)
    atomic_write_json(args.history, history)
    print("VERIFIED", query, observation["observed_at"])
    return 0


def command_merge_history(args) -> int:
    remote = _load(args.remote) if args.remote.exists() else []
    observed = _load(args.observed) if args.observed.exists() else []
    atomic_write_json(args.output, merge_histories(remote, observed))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Naver blog operations data tools")
    sub = parser.add_subparsers(dest="command", required=True)

    collect = sub.add_parser("collect")
    collect.add_argument("--data-dir", type=Path, default=DATA_DIR)
    collect.add_argument("--evidence-dir", type=Path, default=EVIDENCE_DIR)
    collect.add_argument("--delay", type=float, default=6.0)
    collect.set_defaults(handler=command_collect)

    validate = sub.add_parser("validate")
    validate.add_argument("--input", type=Path, default=DATA_DIR / "latest.json")
    validate.set_defaults(handler=command_validate)

    migrate = sub.add_parser("migrate")
    migrate.add_argument("--input", type=Path, required=True)
    migrate.add_argument("--output", type=Path, required=True)
    migrate.set_defaults(handler=command_migrate)

    manual = sub.add_parser("manual-verify")
    manual.add_argument("--evidence", type=Path, required=True)
    manual.add_argument("--latest", type=Path, default=DATA_DIR / "latest.json")
    manual.add_argument("--history", type=Path, default=DATA_DIR / "history.json")
    manual.set_defaults(handler=command_manual_verify)

    merge = sub.add_parser("merge-history")
    merge.add_argument("--remote", type=Path, required=True)
    merge.add_argument("--observed", type=Path, required=True)
    merge.add_argument("--output", type=Path, required=True)
    merge.set_defaults(handler=command_merge_history)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())

