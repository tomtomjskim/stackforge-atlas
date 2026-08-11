#!/usr/bin/env python3
"""Ensure durability validation rejects known metadata and evidence regressions."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_validator(root: Path) -> subprocess.CompletedProcess[str]:
    script = root / "scripts/validate_durability_pilots.py"
    return subprocess.run(
        ["python", str(script)],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )


def copy_repository() -> Path:
    temporary = Path(tempfile.mkdtemp(prefix="stackforge-durability-regression-"))
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


def require_rejection(name: str, mutate) -> None:
    root = copy_repository()
    try:
        mutate(root)
        result = run_validator(root)
        if result.returncode == 0:
            raise AssertionError(f"{name}: validator unexpectedly passed")
    finally:
        shutil.rmtree(root.parent)


def main() -> int:
    require_rejection(
        "missing lease evidence",
        lambda root: (
            root
            / "pilots/order-cancellation-postgres/app/src/worker.ts"
        ).write_text(
            (
                root
                / "pilots/order-cancellation-postgres/app/src/worker.ts"
            ).read_text(encoding="utf-8").replace(
                "FOR UPDATE SKIP LOCKED",
                "FOR UPDATE",
            ),
            encoding="utf-8",
        ),
    )

    require_rejection(
        "missing recovery evidence fragment",
        lambda root: (
            root
            / "pilots/order-cancellation-postgres/durability-manifest.yaml"
        ).write_text(
            (
                root
                / "pilots/order-cancellation-postgres/durability-manifest.yaml"
            ).read_text(encoding="utf-8").replace(
                "#accepted operation survives application instance restart and completes from persisted outbox",
                "#nonexistent restart evidence",
            ),
            encoding="utf-8",
        ),
    )

    require_rejection(
        "missing effective-cancellation uniqueness evidence",
        lambda root: (
            root
            / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.sql"
        ).write_text(
            (
                root
                / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.sql"
            ).read_text(encoding="utf-8").replace(
                "order_cancellations_one_effective_per_order_idx",
                "removed_effective_cancellation_index",
            ),
            encoding="utf-8",
        ),
    )

    require_rejection(
        "missing append-only migration evidence",
        lambda root: (
            root
            / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.sql"
        ).write_text(
            (
                root
                / "pilots/order-cancellation-postgres/migrations/001_order_cancellation.sql"
            ).read_text(encoding="utf-8").replace(
                "audit_events_append_only",
                "removed_audit_trigger",
            ),
            encoding="utf-8",
        ),
    )

    print("Durability validator regression checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
