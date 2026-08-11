#!/usr/bin/env python3
"""Validate generated PostgreSQL operational-recovery evidence."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_operational_report.py REPORT.json", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Operational report could not be read: {error}", file=sys.stderr)
        return 1

    errors: list[str] = []
    require(document.get("version") == 1, "version must be 1", errors)
    require(
        document.get("evidenceLevel") == "operational-recovery-subset",
        "evidenceLevel must remain operational-recovery-subset",
        errors,
    )

    crash = document.get("crashRecovery", {})
    require(crash.get("shutdownSignal") == "SIGQUIT", "crash drill must use SIGQUIT", errors)
    require(integer(crash.get("restartReadyMs")), "restartReadyMs must be an integer", errors)
    require(integer(crash.get("thresholdMs")), "crash threshold must be an integer", errors)
    if integer(crash.get("restartReadyMs")) and integer(crash.get("thresholdMs")):
        require(
            crash["restartReadyMs"] <= crash["thresholdMs"],
            "observed restart exceeded threshold",
            errors,
        )
    require(
        crash.get("observedCommittedRowLoss") == 0,
        "committed rows were lost across immediate restart",
        errors,
    )

    migration = document.get("migration", {})
    require(migration.get("retainedDataVerified") is True, "retained-data migration not verified", errors)
    require(migration.get("guardedRollbackVerified") is True, "guarded rollback not verified", errors)

    backup = document.get("logicalBackupRestore", {})
    require(backup.get("format") == "custom", "logical backup must use custom format", errors)
    digest = backup.get("backupSha256")
    require(
        isinstance(digest, str) and len(digest) == 64,
        "backup SHA-256 is missing or malformed",
        errors,
    )
    require(integer(backup.get("restoreMs")), "restoreMs must be an integer", errors)
    require(integer(backup.get("restoreThresholdMs")), "restore threshold must be an integer", errors)
    if integer(backup.get("restoreMs")) and integer(backup.get("restoreThresholdMs")):
        require(
            backup["restoreMs"] <= backup["restoreThresholdMs"],
            "observed restore exceeded threshold",
            errors,
        )
    require(
        backup.get("primaryCounts") == backup.get("restoredCounts"),
        "restored counts differ from the backup source",
        errors,
    )
    require(
        backup.get("observedPreBackupRowLoss") == 0,
        "pre-backup rows were lost in logical restore",
        errors,
    )

    reconciliation = document.get("reconciliation", {})
    require(reconciliation.get("openCasesBefore") == 1, "drill did not open one reconciliation case", errors)
    require(reconciliation.get("openCasesAfter") == 0, "reconciliation case remained open", errors)
    require(reconciliation.get("resolution") == "COMPLETED", "unexpected drill resolution", errors)

    limitations = document.get("scopeLimitations")
    require(
        isinstance(limitations, list) and len(limitations) >= 4,
        "scope limitations must remain explicit",
        errors,
    )

    if errors:
        print("Operational report validation failed:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Operational report validation passed: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
