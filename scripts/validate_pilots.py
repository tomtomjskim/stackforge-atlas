#!/usr/bin/env python3
"""Validate runnable pilot metadata and contract-to-code references.

This proves structural and referenced-file coherence. It does not prove
production security, persistence, usability, or comparative model quality.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}


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

    fragment = reference.split("#", maxsplit=1)[1] if isinstance(reference, str) and "#" in reference else ""
    if fragment:
        if not path.is_file():
            return path, [f"{location}: fragment cannot target a directory: {fragment}"]
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path, [f"{location}: fragment target is not UTF-8 text: {relative(path)}"]
        if fragment not in content:
            return path, [f"{location}: missing referenced fragment {fragment!r} in {relative(path)}"]
    return path, []


def validate_schema(document_path: Path, schema_path: Path) -> list[str]:
    if not document_path.exists():
        return [f"{relative(document_path)}: missing document"]
    if not schema_path.exists():
        return [f"{relative(schema_path)}: missing schema"]

    document = load_yaml(document_path) if document_path.suffix in {".yaml", ".yml"} else load_json(document_path)
    validator = Draft202012Validator(load_json(schema_path))
    errors: list[str] = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        errors.append(f"{relative(document_path)}:{location}: {error.message}")
    return errors


def collect_openapi_operations(path: Path) -> tuple[dict[str, tuple[str, str]], list[str]]:
    operations: dict[str, tuple[str, str]] = {}
    errors: list[str] = []
    document = load_yaml(path)
    if not isinstance(document, dict):
        return operations, [f"{relative(path)}: OpenAPI document must be an object"]
    if document.get("openapi") != "3.2.0":
        errors.append(f"{relative(path)}: expected OpenAPI 3.2.0")
    paths = document.get("paths")
    if not isinstance(paths, dict):
        return operations, errors + [f"{relative(path)}: paths must be an object"]

    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            operation_id = operation.get("operationId")
            if not isinstance(operation_id, str) or not operation_id:
                errors.append(f"{relative(path)}:{route}:{method}: missing operationId")
            elif operation_id in operations:
                errors.append(f"{relative(path)}: duplicate operationId {operation_id}")
            else:
                operations[operation_id] = (method.upper(), str(route))
    return operations, errors


def validate_manifest(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: manifest must be an object"]

    errors: list[str] = []
    owner = path.parent
    contract_path, reference_errors = require_reference(owner, document.get("contract"), f"{relative(path)}:contract")
    errors.extend(reference_errors)
    screen_path, reference_errors = require_reference(owner, document.get("screen_contract"), f"{relative(path)}:screen_contract")
    errors.extend(reference_errors)

    contract_operations: dict[str, tuple[str, str]] = {}
    if contract_path and contract_path.exists():
        contract_operations, contract_errors = collect_openapi_operations(contract_path)
        errors.extend(contract_errors)

    manifest_operations: dict[str, tuple[str, str]] = {}
    for index, operation in enumerate(document.get("operations", [])):
        location = f"{relative(path)}:operations.{index}"
        if not isinstance(operation, dict):
            errors.append(f"{location}: operation must be an object")
            continue
        operation_id = operation.get("operation_id")
        if not isinstance(operation_id, str):
            continue
        if operation_id in manifest_operations:
            errors.append(f"{location}: duplicate operation_id {operation_id}")
            continue

        actual = (str(operation.get("method", "")).upper(), str(operation.get("path", "")))
        manifest_operations[operation_id] = actual
        expected = contract_operations.get(operation_id)
        if expected is None:
            errors.append(f"{location}: operation is absent from the source contract")
        elif actual != expected:
            errors.append(f"{location}: declared {actual[0]} {actual[1]} but contract defines {expected[0]} {expected[1]}")

        _, reference_errors = require_reference(owner, operation.get("handler"), f"{location}:handler")
        errors.extend(reference_errors)
        for evidence_index, evidence in enumerate(operation.get("evidence", [])):
            _, reference_errors = require_reference(owner, evidence, f"{location}:evidence.{evidence_index}")
            errors.extend(reference_errors)

    if document.get("coverage") == "exact":
        for operation_id in sorted(set(contract_operations) - set(manifest_operations)):
            errors.append(f"{relative(path)}: exact coverage is missing contract operation {operation_id}")
        for operation_id in sorted(set(manifest_operations) - set(contract_operations)):
            errors.append(f"{relative(path)}: exact coverage contains extra operation {operation_id}")

    ui = document.get("ui")
    if isinstance(ui, dict):
        _, reference_errors = require_reference(owner, ui.get("entrypoint"), f"{relative(path)}:ui.entrypoint")
        errors.extend(reference_errors)
        for evidence_index, evidence in enumerate(ui.get("evidence", [])):
            _, reference_errors = require_reference(owner, evidence, f"{relative(path)}:ui.evidence.{evidence_index}")
            errors.extend(reference_errors)

        implemented_states = set(ui.get("implemented_states", []))
        deferred_items = ui.get("deferred_states", [])
        deferred_states = {
            item.get("state")
            for item in deferred_items
            if isinstance(item, dict) and isinstance(item.get("state"), str)
        }
        overlap = implemented_states & deferred_states
        for state in sorted(overlap):
            errors.append(f"{relative(path)}: UI state {state} is both implemented and deferred")

        if screen_path and screen_path.exists():
            screen = load_yaml(screen_path)
            contract_states = set(screen.get("states", {})) if isinstance(screen, dict) else set()
            accounted_states = implemented_states | deferred_states
            for state in sorted(contract_states - accounted_states):
                errors.append(f"{relative(path)}: screen-contract state {state} is unaccounted for")
            for state in sorted(accounted_states - contract_states):
                errors.append(f"{relative(path)}: manifest UI state {state} is absent from the screen contract")
            if ui.get("state_coverage") == "exact" and deferred_states:
                errors.append(f"{relative(path)}: exact UI state coverage cannot contain deferred states")
    return errors


def validate_project_map(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: project map must be an object"]

    errors: list[str] = []
    owner = path.parent
    interfaces = document.get("interfaces")
    if isinstance(interfaces, dict):
        contract_path, reference_errors = require_reference(owner, interfaces.get("source_contract"), f"{relative(path)}:interfaces.source_contract")
        errors.extend(reference_errors)
        manifest_path, reference_errors = require_reference(owner, interfaces.get("implementation_manifest"), f"{relative(path)}:interfaces.implementation_manifest")
        errors.extend(reference_errors)
        declared = set(interfaces.get("operations", []))

        if contract_path and contract_path.exists():
            contract_operations, contract_errors = collect_openapi_operations(contract_path)
            errors.extend(contract_errors)
            for operation_id in sorted(declared - set(contract_operations)):
                errors.append(f"{relative(path)}: operation {operation_id} is absent from the source contract")

        if manifest_path and manifest_path.exists():
            manifest = load_yaml(manifest_path)
            manifest_operations = {
                item.get("operation_id")
                for item in manifest.get("operations", [])
                if isinstance(item, dict) and isinstance(item.get("operation_id"), str)
            }
            if declared != manifest_operations:
                errors.append(f"{relative(path)}: interface operations differ from {relative(manifest_path)}")

    entrypoints = document.get("entrypoints")
    if isinstance(entrypoints, dict):
        for category in ("http", "ui"):
            for index, reference in enumerate(entrypoints.get(category, [])):
                _, reference_errors = require_reference(owner, reference, f"{relative(path)}:entrypoints.{category}.{index}")
                errors.extend(reference_errors)

    modules = document.get("modules", [])
    module_ids = {
        module.get("id")
        for module in modules
        if isinstance(module, dict) and isinstance(module.get("id"), str)
    }
    for index, module in enumerate(modules):
        if not isinstance(module, dict):
            continue
        for path_index, reference in enumerate(module.get("paths", [])):
            _, reference_errors = require_reference(owner, reference, f"{relative(path)}:modules.{index}.paths.{path_index}")
            errors.extend(reference_errors)
        for dependency in module.get("depends_on", []):
            if dependency not in module_ids:
                errors.append(f"{relative(path)}:modules.{index}: unknown dependency {dependency}")
    return errors


def validate_eval_case(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: eval case must be an object"]

    errors: list[str] = []
    owner = path.parent
    fixture = document.get("fixture")
    if isinstance(fixture, dict):
        for field_name in ("project_map", "implementation_manifest", "implementation_root", "source_contract"):
            _, reference_errors = require_reference(owner, fixture.get(field_name), f"{relative(path)}:fixture.{field_name}")
            errors.extend(reference_errors)

    scenario_ids: set[str] = set()
    acceptance = document.get("acceptance")
    if isinstance(acceptance, dict):
        for index, scenario in enumerate(acceptance.get("scenarios", [])):
            if not isinstance(scenario, dict):
                continue
            scenario_id = scenario.get("id")
            if isinstance(scenario_id, str) and scenario_id in scenario_ids:
                errors.append(f"{relative(path)}:acceptance.scenarios.{index}: duplicate id {scenario_id}")
            if isinstance(scenario_id, str):
                scenario_ids.add(scenario_id)
    return errors


def validate_language_profile(path: Path) -> list[str]:
    document = load_yaml(path)
    if not isinstance(document, dict):
        return [f"{relative(path)}: language profile must be an object"]

    errors: list[str] = []
    guidance = document.get("agent_guidance")
    if isinstance(guidance, dict):
        for index, reference in enumerate(guidance.get("context_files", [])):
            _, reference_errors = require_reference(ROOT, reference, f"{relative(path)}:agent_guidance.context_files.{index}")
            errors.extend(reference_errors)
    evidence = document.get("evidence")
    if isinstance(evidence, dict):
        _, reference_errors = require_reference(ROOT, evidence.get("pilot"), f"{relative(path)}:evidence.pilot")
        errors.extend(reference_errors)
    return errors


def main() -> int:
    errors: list[str] = []
    schema_pairs = [
        (ROOT / "templates/project-map/project-map.yaml", ROOT / "schemas/project-map.schema.json"),
        (ROOT / "templates/evaluation/eval-case.yaml", ROOT / "schemas/eval-case.schema.json"),
    ]
    schema_pairs.extend((path, ROOT / "schemas/project-map.schema.json") for path in ROOT.glob("pilots/**/project-map.yaml"))
    schema_pairs.extend((path, ROOT / "schemas/implementation-manifest.schema.json") for path in ROOT.glob("pilots/**/implementation-manifest.yaml"))
    schema_pairs.extend((path, ROOT / "schemas/eval-case.schema.json") for path in ROOT.glob("pilots/**/evaluation/eval-case.yaml"))
    schema_pairs.extend((path, ROOT / "schemas/language-profile.schema.json") for path in ROOT.glob("packs/languages/**/profile.yaml"))

    for document, schema in schema_pairs:
        errors.extend(validate_schema(document, schema))
    for path in ROOT.glob("pilots/**/implementation-manifest.yaml"):
        errors.extend(validate_manifest(path))
    for path in ROOT.glob("pilots/**/project-map.yaml"):
        errors.extend(validate_project_map(path))
    for path in ROOT.glob("pilots/**/evaluation/eval-case.yaml"):
        errors.extend(validate_eval_case(path))
    for path in ROOT.glob("packs/languages/**/profile.yaml"):
        errors.extend(validate_language_profile(path))

    required = [
        ROOT / "docs/CROSS-STACK-PILOTS.md",
        ROOT / "templates/project-map/project-map.yaml",
        ROOT / "templates/evaluation/eval-case.yaml",
        ROOT / "pilots/order-cancellation-node/README.md",
        ROOT / "packs/languages/typescript-node/profile.yaml",
    ]
    errors.extend(f"missing pilot entrypoint: {relative(path)}" for path in required if not path.exists())

    if errors:
        print("Pilot validation failed:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Pilot validation passed: {len(schema_pairs)} structured artifacts checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
