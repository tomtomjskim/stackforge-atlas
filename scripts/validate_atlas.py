#!/usr/bin/env python3
"""Validate StackForge Atlas structured artifacts.

The validator checks syntax, schemas, and cross-artifact contract references.
It does not claim that a product flow is usable, secure, or correct.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
LOCAL_DATA_SOURCES = {"customer-input", "local", "static"}
OPERATION_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")
MARKDOWN_CODE_PATTERN = re.compile(r"`([A-Za-z][A-Za-z0-9]*)`")


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


def resolve_repo_path(owner: Path, reference: Any) -> tuple[Path | None, str | None]:
    if not isinstance(reference, str) or not reference.strip():
        return None, "contract reference must be a non-empty string"
    candidate = (owner / reference).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError:
        return None, f"contract reference escapes repository root: {reference}"
    return candidate, None


def validate_schema(document_path: Path, schema_path: Path) -> list[str]:
    document = load_yaml(document_path) if document_path.suffix in {".yaml", ".yml"} else load_json(document_path)
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema)
    errors: list[str] = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{relative(document_path)}:{location}: {error.message}")
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


def collect_openapi_operation_ids(path: Path) -> tuple[set[str], list[str]]:
    errors: list[str] = []
    operation_ids: set[str] = set()

    try:
        document = load_yaml(path)
    except Exception as exc:
        return operation_ids, [f"{relative(path)}: parse error: {exc}"]

    if not isinstance(document, dict):
        return operation_ids, [f"{relative(path)}: document must be an object"]
    if document.get("openapi") != "3.2.0":
        errors.append(f"{relative(path)}: expected openapi 3.2.0")
    if not isinstance(document.get("info"), dict):
        errors.append(f"{relative(path)}: missing info object")

    paths = document.get("paths")
    if not isinstance(paths, dict) or not paths:
        errors.append(f"{relative(path)}: paths must be a non-empty object")
        return operation_ids, errors

    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS:
                continue
            if not isinstance(operation, dict):
                errors.append(f"{relative(path)}:{route}:{method}: operation must be an object")
                continue
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str) or not operation_id:
                errors.append(f"{relative(path)}:{route}:{method}: missing operationId")
            elif not OPERATION_ID_PATTERN.fullmatch(operation_id):
                errors.append(f"{relative(path)}:{route}:{method}: invalid operationId {operation_id}")
            elif operation_id in operation_ids:
                errors.append(f"{relative(path)}: duplicate operationId {operation_id}")
            else:
                operation_ids.add(operation_id)
            if not isinstance(operation.get("responses"), dict) or not operation["responses"]:
                errors.append(f"{relative(path)}:{route}:{method}: missing responses")

    return operation_ids, errors


def validate_openapi(path: Path) -> list[str]:
    _, errors = collect_openapi_operation_ids(path)
    return errors


def screen_operation_references(screen: Any) -> set[str]:
    references: set[str] = set()
    if not isinstance(screen, dict):
        return references

    for dependency in screen.get("data_dependencies", []):
        if isinstance(dependency, dict) and isinstance(dependency.get("operation_id"), str):
            references.add(dependency["operation_id"])

    for field in screen.get("fields", []):
        if not isinstance(field, dict):
            continue
        data_source = field.get("data_source")
        if (
            isinstance(data_source, str)
            and data_source not in LOCAL_DATA_SOURCES
            and OPERATION_ID_PATTERN.fullmatch(data_source)
        ):
            references.add(data_source)

    for action in screen.get("actions", []):
        if isinstance(action, dict) and isinstance(action.get("operation_id"), str):
            references.add(action["operation_id"])

    return references


def split_markdown_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def validate_traceability_matrix(path: Path, declared_operations: set[str]) -> list[str]:
    if not path.exists():
        return [f"{relative(path)}: missing traceability matrix"]

    lines = path.read_text(encoding="utf-8").splitlines()
    header_index: int | None = None
    operation_column: int | None = None

    for index, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        cells = split_markdown_row(line)
        normalized = [cell.lower() for cell in cells]
        if "interface operation" in normalized:
            header_index = index
            operation_column = normalized.index("interface operation")
            break

    if header_index is None or operation_column is None:
        return [f"{relative(path)}: missing 'Interface operation' table column"]

    referenced_operations: set[str] = set()
    errors: list[str] = []

    for line_number, line in enumerate(lines[header_index + 2 :], start=header_index + 3):
        if not line.lstrip().startswith("|"):
            if referenced_operations:
                break
            continue
        cells = split_markdown_row(line)
        if len(cells) <= operation_column:
            errors.append(f"{relative(path)}:{line_number}: malformed traceability row")
            continue
        operation_cell = cells[operation_column]
        operation_ids = set(MARKDOWN_CODE_PATTERN.findall(operation_cell))
        if not operation_ids and "`N/A`" not in operation_cell:
            errors.append(
                f"{relative(path)}:{line_number}: interface operation cell must name a backticked operationId or `N/A`"
            )
            continue
        referenced_operations.update(operation_ids)
        for operation_id in sorted(operation_ids - declared_operations):
            errors.append(
                f"{relative(path)}:{line_number}: undeclared interface operation {operation_id}"
            )

    for operation_id in sorted(declared_operations - referenced_operations):
        errors.append(f"{relative(path)}: declared operation {operation_id} is absent from the traceability matrix")

    return errors


def validate_feature_slice(directory: Path) -> list[str]:
    errors: list[str] = []
    feature_path = directory / "feature.yaml"
    if not feature_path.exists():
        return [f"{relative(feature_path)}: missing feature slice"]

    try:
        feature = load_yaml(feature_path)
    except Exception as exc:
        return [f"{relative(feature_path)}: parse error: {exc}"]

    if not isinstance(feature, dict):
        return [f"{relative(feature_path)}: document must be an object"]

    declared_operations: set[str] = set()
    contract_operation_cache: dict[Path, set[str]] = {}

    for index, interface in enumerate(feature.get("interfaces", [])):
        location = f"{relative(feature_path)}:interfaces.{index}"
        if not isinstance(interface, dict):
            errors.append(f"{location}: interface must be an object")
            continue

        operation_id = interface.get("operation_id")
        if not isinstance(operation_id, str):
            errors.append(f"{location}: missing operation_id")
            continue
        if operation_id in declared_operations:
            errors.append(f"{location}: duplicate operation_id {operation_id}")
        declared_operations.add(operation_id)

        contract_path, path_error = resolve_repo_path(directory, interface.get("contract"))
        if path_error:
            errors.append(f"{location}: {path_error}")
            continue
        assert contract_path is not None
        if not contract_path.exists():
            errors.append(f"{location}: missing contract {relative(contract_path)}")
            continue

        interface_type = interface.get("type")
        if interface_type == "openapi":
            if contract_path not in contract_operation_cache:
                operations, contract_errors = collect_openapi_operation_ids(contract_path)
                contract_operation_cache[contract_path] = operations
                errors.extend(contract_errors)
            if operation_id not in contract_operation_cache[contract_path]:
                errors.append(
                    f"{location}: operation_id {operation_id} is absent from {relative(contract_path)}"
                )
        elif interface_type == "asyncapi":
            # AsyncAPI cross-reference validation will be added with the first AsyncAPI worked example.
            pass
        else:
            errors.append(f"{location}: unsupported interface type {interface_type}")

    for index, surface in enumerate(feature.get("surfaces", [])):
        location = f"{relative(feature_path)}:surfaces.{index}"
        if not isinstance(surface, dict):
            errors.append(f"{location}: surface must be an object")
            continue
        contract_path, path_error = resolve_repo_path(directory, surface.get("contract"))
        if path_error:
            errors.append(f"{location}: {path_error}")
            continue
        assert contract_path is not None
        if not contract_path.exists():
            errors.append(f"{location}: missing screen contract {relative(contract_path)}")
            continue
        try:
            screen = load_yaml(contract_path)
        except Exception as exc:
            errors.append(f"{relative(contract_path)}: parse error: {exc}")
            continue
        if not isinstance(screen, dict):
            errors.append(f"{relative(contract_path)}: screen contract must be an object")
            continue
        if screen.get("id") != surface.get("id"):
            errors.append(
                f"{relative(contract_path)}: screen id {screen.get('id')} does not match surface id {surface.get('id')}"
            )

        screen_references = screen_operation_references(screen)
        for operation_id in sorted(screen_references - declared_operations):
            errors.append(
                f"{relative(contract_path)}: operation reference {operation_id} is not declared in feature.yaml"
            )

    errors.extend(validate_traceability_matrix(directory / "traceability-matrix.md", declared_operations))
    return errors


def validate_entrypoints() -> list[str]:
    required = [
        ROOT / "assets/brand/stackforge-atlas-hero.svg",
        ROOT / "docs/START-HERE.md",
        ROOT / "core/experience/product-interface-delivery.md",
        ROOT / "templates/feature-slice/README.md",
        ROOT / "examples/order-cancellation/README.md",
    ]
    return [f"missing required entrypoint: {relative(path)}" for path in required if not path.exists()]


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
            errors.append(f"{relative(path)}: parse error: {exc}")

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
            errors.append(f"{relative(token_path)}:{error}")

    for openapi_path in [
        ROOT / "templates/feature-slice/openapi.yaml",
        ROOT / "examples/order-cancellation/openapi.yaml",
    ]:
        errors.extend(validate_openapi(openapi_path))

    for feature_directory in [
        ROOT / "templates/feature-slice",
        ROOT / "examples/order-cancellation",
    ]:
        errors.extend(validate_feature_slice(feature_directory))

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
