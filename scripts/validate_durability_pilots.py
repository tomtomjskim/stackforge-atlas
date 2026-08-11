#!/usr/bin/env python3
"""Validate data-store profiles and durability-pilot evidence.

This validates declared references and a small set of executable design
invariants. It does not prove production recovery, performance, or security.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]


def load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve_reference(owner: Path, reference: Any) -> tuple[Path | None, str | None]:
    if not isinstance(reference, str) or not reference.strip():
        return None, "path reference must be a non-empty string"
    path_part = reference.split("#", maxsplit=1)[0]
    candidate = (owner / path_part).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError:
        return None, f"path reference escapes repository root: {reference}"
    return candidate, None


def require_reference(
    owner: Path,
    reference: Any,
    location: str,
) -> tuple[Path | None, list[str]]:
    path, error = resolve_reference(owner, reference)
    if error:
        return None, [f"{location}: {error}"]
    assert path is not None
    if not path.exists():
        return path, [f"{location}: missing referenced path {relative(path)}"]

    fragment = (
        reference.split("#", maxsplit=1)[1]
        if isinstance(reference, str) and "#" in reference
        else ""
    )
    if fragment:
        if not path.is_file():
            return path, [f"{location}: fragment cannot target a directory"]
        content = path.read_text(encoding="utf-8")
        if fragment not in content:
            return path, [
                f"{location}: missing referenced fragment {fragment!r} "
                f"in {relative(path)}"
            ]
    return path, []


def validate_schema(document_path: Path, schema_path: Path) -> list[str]:
    document = load_yaml(document_path)
    schema = load_json(schema_path)
    errors: list[str] = []
    validator = Draft202012Validator(schema)
    for error in sorted(
        validator.iter_errors(document),
        key=lambda item: list(item.absolute_path),
    ):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{relative(document_path)}:{location}: {error.message}")
    return errors


def validate_data_store_profile(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: profile must be an object"]

    errors: list[str] = []
    guidance = document.get("agent_guidance")
    if isinstance(guidance, dict):
        for index, reference in enumerate(guidance.get("context_files", [])):
            _, reference_errors = require_reference(
                ROOT,
                reference,
                f"{relative(path)}:agent_guidance.context_files.{index}",
            )
            errors.extend(reference_errors)

    evidence = document.get("evidence")
    if isinstance(evidence, dict):
        _, reference_errors = require_reference(
            ROOT,
            evidence.get("pilot"),
            f"{relative(path)}:evidence.pilot",
        )
        errors.extend(reference_errors)
    return errors


def validate_durability_manifest(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: durability manifest must be an object"]

    errors: list[str] = []
    owner = path.parent

    _, reference_errors = require_reference(
        owner,
        document.get("data_store_profile"),
        f"{relative(path)}:data_store_profile",
    )
    errors.extend(reference_errors)

    migration = document.get("migration")
    migration_up: Path | None = None
    if isinstance(migration, dict):
        for field in ("up", "down", "runner"):
            resolved, reference_errors = require_reference(
                owner,
                migration.get(field),
                f"{relative(path)}:migration.{field}",
            )
            errors.extend(reference_errors)
            if field == "up":
                migration_up = resolved

    transaction = document.get("transaction")
    if isinstance(transaction, dict):
        _, reference_errors = require_reference(
            owner,
            transaction.get("entrypoint"),
            f"{relative(path)}:transaction.entrypoint",
        )
        errors.extend(reference_errors)

    outbox = document.get("outbox")
    if isinstance(outbox, dict):
        worker_path, reference_errors = require_reference(
            owner,
            outbox.get("worker"),
            f"{relative(path)}:outbox.worker",
        )
        errors.extend(reference_errors)
        if worker_path and worker_path.exists():
            worker_source = worker_path.read_text(encoding="utf-8")
            for token in ("FOR UPDATE SKIP LOCKED", "locked_at", "published_at"):
                if token not in worker_source:
                    errors.append(
                        f"{relative(path)}: worker evidence is missing {token!r}"
                    )

    recovery = document.get("recovery")
    scenario_ids: set[str] = set()
    if isinstance(recovery, dict):
        for index, scenario in enumerate(recovery.get("scenarios", [])):
            if not isinstance(scenario, dict):
                continue
            scenario_id = scenario.get("id")
            if isinstance(scenario_id, str):
                if scenario_id in scenario_ids:
                    errors.append(
                        f"{relative(path)}:recovery.scenarios.{index}: "
                        f"duplicate id {scenario_id}"
                    )
                scenario_ids.add(scenario_id)
            _, reference_errors = require_reference(
                owner,
                scenario.get("evidence"),
                f"{relative(path)}:recovery.scenarios.{index}.evidence",
            )
            errors.extend(reference_errors)

    if migration_up and migration_up.exists():
        sql = migration_up.read_text(encoding="utf-8")
        required_sql = (
            "CREATE TABLE order_cancellations",
            "CREATE TABLE outbox_events",
            "CREATE TABLE audit_events",
            "CREATE TABLE provider_cancellation_effects",
            "order_cancellations_one_effective_per_order_idx",
            "audit_events_append_only",
        )
        for token in required_sql:
            if token not in sql:
                errors.append(
                    f"{relative(path)}: migration evidence is missing {token!r}"
                )
    return errors


def main() -> int:
    errors: list[str] = []
    profile_schema = ROOT / "schemas/data-store-profile.schema.json"
    durability_schema = ROOT / "schemas/durability-manifest.schema.json"

    profile_paths = [
        ROOT / "templates/data-store/profile.yaml",
        *ROOT.glob("packs/data-stores/**/profile.yaml"),
    ]
    durability_paths = list(ROOT.glob("pilots/**/durability-manifest.yaml"))

    for path in profile_paths:
        if not path.exists():
            errors.append(f"missing data-store profile: {relative(path)}")
            continue
        errors.extend(validate_schema(path, profile_schema))
        if "packs/data-stores" in path.as_posix():
            errors.extend(validate_data_store_profile(path))

    for path in durability_paths:
        errors.extend(validate_schema(path, durability_schema))
        errors.extend(validate_durability_manifest(path))

    required = [
        ROOT / "packs/data-stores/postgresql/profile.yaml",
        ROOT / "pilots/order-cancellation-postgres/README.md",
        ROOT / "pilots/order-cancellation-postgres/durability-manifest.yaml",
        ROOT / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.sql",
        ROOT / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.down.sql",
    ]
    errors.extend(
        f"missing durability entrypoint: {relative(path)}"
        for path in required
        if not path.exists()
    )

    if errors:
        print("Durability validation failed:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Durability validation passed: "
        f"{len(profile_paths)} data-store profiles and "
        f"{len(durability_paths)} durability manifests checked."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
