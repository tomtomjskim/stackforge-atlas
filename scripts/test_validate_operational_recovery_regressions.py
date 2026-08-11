#!/usr/bin/env python3
"""Ensure operational-recovery validation rejects known evidence regressions."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def copy_repository() -> Path:
    temporary = Path(tempfile.mkdtemp(prefix="stackforge-operational-regression-"))
    destination = temporary / "repo"
    shutil.copytree(
        ROOT,
        destination,
        ignore=shutil.ignore_patterns(
            ".git",
            "node_modules",
            "__pycache__",
            "*.pyc",
        ),
    )
    return destination


def run_validator(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python", str(root / "scripts/validate_operational_recovery.py")],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )


def require_rejection(name: str, mutate) -> None:
    root = copy_repository()
    try:
        mutate(root)
        result = run_validator(root)
        if result.returncode == 0:
            raise AssertionError(f"{name}: validator unexpectedly passed")
    finally:
        shutil.rmtree(root.parent)


def replace(path: Path, old: str, new: str) -> None:
    content = path.read_text(encoding="utf-8")
    if old not in content:
        raise AssertionError(f"regression fixture token missing: {old}")
    path.write_text(content.replace(old, new, 1), encoding="utf-8")


def main() -> int:
    require_rejection(
        "missing immediate-shutdown evidence",
        lambda root: replace(
            root / "pilots/order-cancellation-postgres/operational/run-recovery-drill.sh",
            "docker kill --signal=SIGQUIT",
            "docker stop",
        ),
    )
    require_rejection(
        "missing independent restore evidence",
        lambda root: (
            root / "pilots/order-cancellation-postgres/operational/run-recovery-drill.sh"
        ).write_text(
            (
                root / "pilots/order-cancellation-postgres/operational/run-recovery-drill.sh"
            ).read_text(encoding="utf-8").replace(
                "pg_restore",
                "removed_restore_command",
            ),
            encoding="utf-8",
        ),
    )
    require_rejection(
        "missing destructive rollback guard",
        lambda root: replace(
            root / "pilots/order-cancellation-postgres/migrations/002_reconciliation_cases.down.sql",
            "cannot be rolled back after reconciliation data exists",
            "rollback without data guard",
        ),
    )
    require_rejection(
        "missing reconciliation trigger",
        lambda root: replace(
            root / "pilots/order-cancellation-postgres/migrations/002_reconciliation_cases.sql",
            "outbox_open_reconciliation_case",
            "removed_reconciliation_trigger",
        ),
    )
    require_rejection(
        "missing operational CI job",
        lambda root: replace(
            root / ".github/workflows/validate.yml",
            "postgres-operational-recovery:",
            "removed-operational-recovery-job:",
        ),
    )
    require_rejection(
        "broken operator resolution evidence",
        lambda root: replace(
            root / "pilots/order-cancellation-postgres/operational/manifest.yaml",
            "#completed reconciliation resolves cancellation, order, outbox, and audit atomically",
            "#nonexistent reconciliation evidence",
        ),
    )

    print("Operational recovery validator regression checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
