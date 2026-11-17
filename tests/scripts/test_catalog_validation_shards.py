"""Catalog validation covers every admitted entry exactly once across runner shards."""

from collections import Counter
import json
import os
import subprocess
import sys

import pytest

from scripts.ci.catalog_validation_shards import partition_entries


@pytest.mark.parametrize("size", [0, 1, 7, 8, 9, 1229])
def test_shards_cover_the_full_catalog_without_overlap_or_omission(size):
    entries = [f"plugin-catalog/plugin-{index}.yaml" for index in range(size)]
    shards = partition_entries(entries, 8)
    assigned = [entry for shard in shards for entry in str(shard["files"]).splitlines()]
    assert Counter(assigned) == Counter(entries)
    assert len(shards) == min(8, size)
    sizes = [len(str(shard["files"]).splitlines()) for shard in shards]
    assert not sizes or max(sizes) - min(sizes) <= 1
    assert partition_entries(entries, 8) == shards


def test_shards_refuse_duplicate_entries_and_invalid_runner_count():
    with pytest.raises(ValueError, match="unique"):
        partition_entries(["plugin-catalog/repeated.yaml"] * 2, 8)
    with pytest.raises(ValueError, match="positive"):
        partition_entries(["plugin-catalog/one.yaml"], 0)


def test_command_emits_a_github_matrix_for_the_complete_changed_file_list():
    entries = [f"plugin-catalog/entry-{index}.yaml" for index in range(19)]
    result = subprocess.run(
        [sys.executable, "scripts/ci/catalog_validation_shards.py", "--count", "8"],
        env={**os.environ, "CHANGED_FILES": "\n".join(entries)},
        capture_output=True, text=True, check=True,
    )
    key, value = result.stdout.strip().split("=", 1)
    assert key == "matrix"
    shards = json.loads(value)["include"]
    assert len(shards) == 8
    assert sorted(entry for shard in shards for entry in shard["files"].splitlines()) == sorted(entries)
