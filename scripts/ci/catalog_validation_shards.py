#!/usr/bin/env python3
"""Partition the complete admitted catalog list across isolated validation runners."""

from __future__ import annotations

import argparse
import json
import os


def partition_entries(entries: list[str], count: int) -> list[dict[str, int | str]]:
    """Assign each entry once by stable input index, balancing alphabetic clusters."""
    if count < 1:
        raise ValueError("catalog shard count must be positive")
    if len(entries) != len(set(entries)):
        raise ValueError("catalog validation entries must be unique")
    return [
        {"index": index, "files": "\n".join(entries[index::count])}
        for index in range(min(count, len(entries)))
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=8)
    args = parser.parse_args()
    entries = list(filter(None, os.environ["CHANGED_FILES"].split("\n")))
    # A no-entry plan is skipped before matrix expansion, but its output remains valid JSON.
    shards = partition_entries(entries, args.count) or [{"index": 0, "files": ""}]
    print("matrix=" + json.dumps({"include": shards}, separators=(",", ":")))


if __name__ == "__main__":
    main()
