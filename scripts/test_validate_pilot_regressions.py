#!/usr/bin/env python3
"""Negative regression checks for the pilot metadata validator.

Each case mutates a temporary repository copy. A test succeeds only when the
validator rejects the intentionally inconsistent artifacts for the expected
reason.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

SOURCE_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path("pilots/order-cancellation-node/implementation-manifest.yaml")


def run_validator(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "scripts/validate_pilots.py"],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )


def load_manifest(root: Path) -> dict[str, Any]:
    document = yaml.safe_load((root / MANIFEST).read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise AssertionError("pilot manifest must be an object")
    return document


def write_manifest(root: Path, document: dict[str, Any]) -> None:
    (root / MANIFEST).write_text(
        yaml.safe_dump(document, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def remove_status_operation(root: Path) -> None:
    manifest = load_manifest(root)
    manifest["operations"] = [
        operation
        for operation in manifest["operations"]
        if operation.get("operation_id") != "getOrderCancellation"
    ]
    write_manifest(root, manifest)


def corrupt_evidence_fragment(root: Path) -> None:
    manifest = load_manifest(root)
    manifest["operations"][0]["evidence"][0] = (
        "app/test/http.test.ts#missing-evidence-title"
    )
    write_manifest(root, manifest)


def leave_pending_state_unaccounted(root: Path) -> None:
    manifest = load_manifest(root)
    manifest["ui"]["implemented_states"] = [
        state for state in manifest["ui"]["implemented_states"] if state != "pending"
    ]
    write_manifest(root, manifest)


def expect_rejection(
    root: Path,
    name: str,
    mutation: Callable[[Path], None],
    expected_message: str,
) -> None:
    original = (root / MANIFEST).read_text(encoding="utf-8")
    try:
        mutation(root)
        result = run_validator(root)
        if result.returncode == 0:
            raise AssertionError(f"{name}: validator accepted an invalid fixture")
        output = f"{result.stdout}\n{result.stderr}"
        if expected_message not in output:
            raise AssertionError(
                f"{name}: expected {expected_message!r} in validator output:\n{output}"
            )
    finally:
        (root / MANIFEST).write_text(original, encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="stackforge-pilot-regressions-") as temp:
        root = Path(temp) / "repo"
        shutil.copytree(
            SOURCE_ROOT,
            root,
            ignore=shutil.ignore_patterns(
                ".git",
                ".venv",
                "node_modules",
                "__pycache__",
                "*.pyc",
            ),
        )

        baseline = run_validator(root)
        if baseline.returncode != 0:
            raise AssertionError(
                "baseline pilot validation failed before negative mutations:\n"
                f"{baseline.stdout}\n{baseline.stderr}"
            )

        expect_rejection(
            root,
            "missing operation coverage",
            remove_status_operation,
            "exact coverage is missing contract operation getOrderCancellation",
        )
        expect_rejection(
            root,
            "broken evidence fragment",
            corrupt_evidence_fragment,
            "missing referenced fragment 'missing-evidence-title'",
        )
        expect_rejection(
            root,
            "unaccounted screen state",
            leave_pending_state_unaccounted,
            "screen-contract state pending is unaccounted for",
        )

    print("Pilot validator regression checks passed: 3 invalid fixtures rejected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
