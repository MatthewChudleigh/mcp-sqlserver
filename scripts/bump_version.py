#!/usr/bin/env python3
"""Bump the project version across package.json, package-lock.json, the plugin manifests, and the hardcoded version strings in src/cli.ts and src/index.ts."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
PACKAGE_LOCK = ROOT / "package-lock.json"
PLUGIN_JSON = ROOT / ".claude-plugin" / "plugin.json"
MARKETPLACE_JSON = ROOT / ".claude-plugin" / "marketplace.json"
CLI_TS = ROOT / "src" / "cli.ts"
INDEX_TS = ROOT / "src" / "index.ts"

PLUGIN_NAME = "mcp-sqlserver"
NPM_PACKAGE_NAME = "@ibergeni/mcp-sqlserver"

VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def parse_version(value: str) -> tuple[int, int, int]:
    match = VERSION_RE.match(value)
    if not match:
        raise ValueError(f"Invalid version: {value!r} (expected n.n.n)")
    return int(match[1]), int(match[2]), int(match[3])


def bump(current: str, part: str) -> str:
    major, minor, patch = parse_version(current)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown bump part: {part}")


def replace_in_file(path: Path, pattern: re.Pattern[str], replacement: str, label: str, expected_count: int = 1) -> None:
    text = path.read_text(encoding="utf-8")
    new_text, count = pattern.subn(replacement, text)
    if count != expected_count:
        raise RuntimeError(
            f"Expected {expected_count} match(es) for {label} in {path.relative_to(ROOT)}, found {count}"
        )
    # newline="" prevents Windows CRLF translation. The replacement preserves
    # whatever line endings the source file already used.
    path.write_text(new_text, encoding="utf-8", newline="")


# --- patterns -------------------------------------------------------------

# Top-level "version" line in package.json (the package's own version, which
# is the second top-level field after "name").
PACKAGE_JSON_RE = re.compile(
    r'(\A\{\s*\n\s*"name"\s*:\s*"' + re.escape(NPM_PACKAGE_NAME) + r'"\s*,\s*\n\s*"version"\s*:\s*")[^"]+(")',
)

# package-lock.json has two version fields tied to the project: the top-level
# one and packages[""].version. Both sit immediately after a "name" key
# referencing the npm package, which makes them safe to target without
# matching dependency versions.
PACKAGE_LOCK_RE = re.compile(
    r'("name"\s*:\s*"' + re.escape(NPM_PACKAGE_NAME) + r'"\s*,\s*\n\s+"version"\s*:\s*")[^"]+(")',
)

# Top-level "version" in .claude-plugin/plugin.json — the file describes a
# single plugin so the very first "version" key is the right one.
PLUGIN_JSON_RE = re.compile(
    r'(\A\{.*?"version"\s*:\s*")[^"]+(")',
    re.DOTALL,
)

# .claude-plugin/marketplace.json: match the "version" field inside the entry
# whose "name" matches our plugin. The non-greedy `.*?` walks through the
# nested `source` object to reach the first "version" after the plugin name.
MARKETPLACE_JSON_RE = re.compile(
    r'("name"\s*:\s*"' + re.escape(PLUGIN_NAME) + r'"\s*,.*?"version"\s*:\s*")[^"]+(")',
    re.DOTALL,
)

# `console.log('X.Y.Z');` inside the showVersion() function in src/cli.ts.
CLI_TS_RE = re.compile(
    r"(function\s+showVersion\s*\(\s*\)\s*\{\s*console\.log\(')[^']+('\)\s*;)",
    re.DOTALL,
)

# `name: 'mcp-sqlserver',\n  version: 'X.Y.Z',` in the Server constructor.
INDEX_TS_RE = re.compile(
    r"(name:\s*'mcp-sqlserver'\s*,\s*\n\s*version:\s*')[^']+(')",
)


def read_current_version() -> str:
    text = PACKAGE_JSON.read_text(encoding="utf-8")
    match = PACKAGE_JSON_RE.search(text)
    if not match:
        raise RuntimeError("Could not read current version from package.json")
    after_prefix = text[match.end(1):]
    end = after_prefix.index('"')
    return after_prefix[:end]


def bump_all(new_version: str) -> None:
    repl = rf"\g<1>{new_version}\g<2>"
    replace_in_file(PACKAGE_JSON, PACKAGE_JSON_RE, repl, "version in package.json")
    if PACKAGE_LOCK.exists():
        replace_in_file(PACKAGE_LOCK, PACKAGE_LOCK_RE, repl, "version in package-lock.json", expected_count=2)
    replace_in_file(PLUGIN_JSON, PLUGIN_JSON_RE, repl, "version in plugin.json")
    replace_in_file(MARKETPLACE_JSON, MARKETPLACE_JSON_RE, repl, f"{PLUGIN_NAME} entry in marketplace.json")
    replace_in_file(CLI_TS, CLI_TS_RE, repl, "showVersion() literal in src/cli.ts")
    replace_in_file(INDEX_TS, INDEX_TS_RE, repl, "Server constructor version in src/index.ts")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--major", action="store_true", help="Bump the major version")
    group.add_argument("--minor", action="store_true", help="Bump the minor version")
    group.add_argument("--patch", action="store_true", help="Bump the patch version (default)")
    group.add_argument("--version", metavar="N.N.N", help="Set the version explicitly")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    current = read_current_version()
    parse_version(current)

    if args.version:
        parse_version(args.version)
        new_version = args.version
    elif args.major:
        new_version = bump(current, "major")
    elif args.minor:
        new_version = bump(current, "minor")
    else:
        new_version = bump(current, "patch")

    bump_all(new_version)

    print(f"Bumped version: {current} -> {new_version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
