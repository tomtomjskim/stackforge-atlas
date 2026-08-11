#!/usr/bin/env python3
"""Validate StackForge Atlas structured artifacts.

This validator checks structural coherence only. It does not claim that a
product flow is usable, secure, or correct.
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


def validate_schema(document_path: Path, schema_path: Path) -> list[str]:
    document = load_yaml(document_path) if document_path.suffix in {".yaml", ".yml"} else load_json(document_path)
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema)
    errors: list[str] = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{document_path.relative_to(ROOT)}:{location}: {error.message}")
    return errors


def walk_token_nodes(node: Any, path: tuple[str, ...] = ()) -> list[str]:
    errors: list[str] = []
    if not isinstance(node, dict):
        return [f"{'.'.join(path) or '<root>'}: token group must be an object"]
    if "$value" in node:
        if any(not key.startswith("$") for key in node):
            errors.append(f"{'.'.join(path)}: a token cannot also contain child token names")
        return errors
    for key, value in node.items():
        if not key.startswith("$"):
            errors.extend(walk_token_nodes(value, path + (key,)))
    return errors


def validate_openapi(path: Path) -> list[str]:
    document = load_yaml(path)
    errors: list[str] = []
    if not isinstance(document, dict):
        return [f"{path.relative_to(ROOT)}: document must be an object"]
    if document.get("openapi") != "3.2.0":
        errors.append(f"{path.relative_to(ROOT)}: expected openapi 3.2.0")
    if not isinstance(document.get("info"), dict):
        errors.append(f"{path.relative_to(ROOT)}: missing info object")
    paths = document.get("paths")
    if not isinstance(paths, dict) or not paths:
        errors.append(f"{path.relative_to(ROOT)}: paths must be a non-empty object")
        return errors

    operation_ids: set[str] = set()
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "head", "options", "trace"}:
                continue
            if not isinstance(operation, dict):
                errors.append(f"{path.relative_to(ROOT)}:{route}:{method}: operation must be an object")
                continue
            operation_id = operation.get("operationId")
            if not operation_id:
                errors.append(f"{path.relative_to(ROOT)}:{route}:{method}: missing operationId")
            elif operation_id in operation_ids:
                errors.append(f"{path.relative_to(ROOT)}: duplicate operationId {operation_id}")
            else:
                operation_ids.add(operation_id)
            if not isinstance(operation.get("responses"), dict) or not operation["responses"]:
                errors.append(f"{path.relative_to(ROOT)}:{route}:{method}: missing responses")
    return errors


def validate_entrypoints() -> list[str]:
    required = [
        ROOT / "assets/brand/stackforge-atlas-hero.svg",
        ROOT / "docs/START-HERE.md",
        ROOT / "core/experience/product-interface-delivery.md",
        ROOT / "templates/feature-slice/README.md",
        ROOT / "examples/order-cancellation/README.md",
    ]
    return [f"missing required entrypoint: {path.relative_to(ROOT)}" for path in required if not path.exists()]


def main() -> int:
    errors: list[str] = []

    parse_targets = sorted(
        path for path in ROOT.rglob("*")
        if path.is_file() and path.suffix in {".json", ".yaml", ".yml"}
    )
    for path in parse_targets:
        try:
            load_json(path) if path.suffix == ".json" else load_yaml(path)
        except Exception as exc:
            errors.append(f"{path.relative_to(ROOT)}: parse error: {exc}")

    schema_pairs = [
        (ROOT / "templates/feature-slice/feature.yaml", ROOT / "schemas/feature-slice.schema.json"),
        (ROOT / "templates/feature-slice/screen-contract.yaml", ROOT / "schemas/screen-contract.schema.json"),
        (ROOT / "templates/design-system/component-contract.yaml", ROOT / "schemas/component-contract.schema.json"),
        (ROOT / "examples/order-cancellation/feature.yaml", ROOT / "schemas/feature-slice.schema.json"),
        (ROOT / "examples/order-cancellation/screen-contract.yaml", ROOT / "schemas/screen-contract.schema.json"),
        (ROOT / "examples/order-cancellation/component-contract.yaml", ROOT / "schemas/component-contract.schema.json"),
    ]
    for document, schema in schema_pairs:
        errors.extend(validate_schema(document, schema))

    for token_path in [
        ROOT / "templates/feature-slice/design-tokens.json",
        ROOT / "examples/order-cancellation/design-tokens.json",
    ]:
        for error in walk_token_nodes(load_json(token_path)):
            errors.append(f"{token_path.relative_to(ROOT)}:{error}")

    for openapi_path in [
        ROOT / "templates/feature-slice/openapi.yaml",
        ROOT / "examples/order-cancellation/openapi.yaml",
    ]:
        errors.extend(validate_openapi(openapi_path))

    errors.extend(validate_entrypoints())

    if errors:
        print("Atlas validation failed:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Atlas validation passed: {len(parse_targets)} structured files checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
