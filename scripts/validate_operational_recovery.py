#!/usr/bin/env python3
"""Validate operational-recovery manifests and executable evidence references."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SCHEMA = ROOT / "schemas/operational-recovery-manifest.schema.json"


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


def require_reference(owner: Path, reference: Any, location: str) -> tuple[Path | None, list[str]]:
    path, error = resolve_reference(owner, reference)
    if error:
        return None, [f"{location}: {error}"]
    assert path is not None
    if not path.exists():
        return path, [f"{location}: missing referenced path {relative(path)}"]

    fragment = reference.split("#", maxsplit=1)[1] if "#" in str(reference) else ""
    if fragment:
        if not path.is_file():
            return path, [f"{location}: fragment cannot target a directory"]
        content = path.read_text(encoding="utf-8")
        if fragment not in content:
            return path, [
                f"{location}: missing referenced fragment {fragment!r} in {relative(path)}"
            ]
    return path, []


def validate_schema(path: Path) -> list[str]:
    document = load_yaml(path)
    validator = Draft202012Validator(load_json(MANIFEST_SCHEMA))
    errors: list[str] = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{relative(path)}:{location}: {error.message}")
    return errors


def validate_manifest(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: manifest must be an object"]

    errors: list[str] = []
    owner = path.parent
    simple_references = (
        "data_store_profile",
        "runner",
        "report_validator",
        "runbook",
        "alerts",
    )
    resolved: dict[str, Path] = {}
    for field in simple_references:
        target, reference_errors = require_reference(
            owner,
            document.get(field),
            f"{relative(path)}:{field}",
        )
        errors.extend(reference_errors)
        if target:
            resolved[field] = target

    migration = document.get("migration")
    migration_paths: dict[str, Path] = {}
    if isinstance(migration, dict):
        for field in ("baseline", "forward", "rollback", "runner", "rollback_runner"):
            target, reference_errors = require_reference(
                owner,
                migration.get(field),
                f"{relative(path)}:migration.{field}",
            )
            errors.extend(reference_errors)
            if target:
                migration_paths[field] = target

    reconciliation = document.get("reconciliation")
    if isinstance(reconciliation, dict):
        for field in ("service", "operator_command"):
            _, reference_errors = require_reference(
                owner,
                reconciliation.get(field),
                f"{relative(path)}:reconciliation.{field}",
            )
            errors.extend(reference_errors)

    scenario_ids: set[str] = set()
    for index, scenario in enumerate(document.get("scenarios", [])):
        if not isinstance(scenario, dict):
            continue
        scenario_id = scenario.get("id")
        if isinstance(scenario_id, str):
            if scenario_id in scenario_ids:
                errors.append(f"{relative(path)}:scenarios.{index}: duplicate id {scenario_id}")
            scenario_ids.add(scenario_id)
        _, reference_errors = require_reference(
            owner,
            scenario.get("evidence"),
            f"{relative(path)}:scenarios.{index}.evidence",
        )
        errors.extend(reference_errors)

    runner = resolved.get("runner")
    if runner and runner.exists():
        source = runner.read_text(encoding="utf-8")
        required_tokens = (
            "docker kill --signal=SIGQUIT",
            "pg_dump",
            "pg_restore",
            "MIGRATION_TARGET=001_order_cancellation.sql",
            "npm run rollback",
            "resolve-reconciliation",
            "validate_operational_report.py",
        )
        for token in required_tokens:
            if token not in source:
                errors.append(f"{relative(path)}: recovery runner is missing {token!r}")

    forward = migration_paths.get("forward")
    if forward and forward.exists():
        sql = forward.read_text(encoding="utf-8")
        for token in (
            "CREATE TABLE reconciliation_cases",
            "outbox_open_reconciliation_case",
            "CREATE VIEW operational_recovery_health",
        ):
            if token not in sql:
                errors.append(f"{relative(path)}: forward migration is missing {token!r}")

    rollback = migration_paths.get("rollback")
    if rollback and rollback.exists():
        sql = rollback.read_text(encoding="utf-8")
        for token in (
            "cannot be rolled back after reconciliation data exists",
            "DROP VIEW operational_recovery_health",
            "DROP TABLE reconciliation_cases",
        ):
            if token not in sql:
                errors.append(f"{relative(path)}: rollback migration is missing {token!r}")

    alerts = resolved.get("alerts")
    if alerts and alerts.exists():
        catalog = load_yaml(alerts)
        signal_ids = {
            item.get("id")
            for item in catalog.get("signals", [])
            if isinstance(item, dict)
        } if isinstance(catalog, dict) else set()
        for required_signal in (
            "reconciliation-cases-open",
            "oldest-pending-operation",
            "expired-worker-lease",
            "ready-outbox-backlog",
            "migration-drift",
        ):
            if required_signal not in signal_ids:
                errors.append(
                    f"{relative(path)}: alert catalog is missing {required_signal}"
                )

    workflow = ROOT / ".github/workflows/validate.yml"
    if workflow.exists():
        workflow_source = workflow.read_text(encoding="utf-8")
        for token in (
            "postgres-operational-recovery:",
            "run-recovery-drill.sh",
            "operational-recovery-report.json",
        ):
            if token not in workflow_source:
                errors.append(f"{relative(path)}: CI workflow is missing {token!r}")
    else:
        errors.append("missing .github/workflows/validate.yml")

    return errors


def main() -> int:
    errors: list[str] = []
    template = ROOT / "templates/operations/postgres-recovery-manifest.yaml"
    if not template.exists():
        errors.append(f"missing operational template: {relative(template)}")
    else:
        errors.extend(validate_schema(template))

    manifests = list(ROOT.glob("pilots/**/operational/manifest.yaml"))
    if not manifests:
        errors.append("no operational recovery manifests found")
    for path in manifests:
        errors.extend(validate_schema(path))
        errors.extend(validate_manifest(path))

    required = [
        ROOT / "pilots/order-cancellation-postgres/operational/README.md",
        ROOT / "pilots/order-cancellation-postgres/operational/runbook.md",
        ROOT / "pilots/order-cancellation-postgres/operational/alerts.yaml",
        ROOT / "pilots/order-cancellation-postgres/app/src/reconciliation.ts",
        ROOT / "pilots/order-cancellation-postgres/app/src/rollback.ts",
        ROOT / "scripts/validate_operational_report.py",
    ]
    errors.extend(
        f"missing operational recovery entrypoint: {relative(path)}"
        for path in required
        if not path.exists()
    )

    if errors:
        print("Operational recovery validation failed:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Operational recovery validation passed: "
        f"{len(manifests)} manifest(s) checked."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
