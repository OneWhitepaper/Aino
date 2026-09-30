"""External behavior oracle for the historical streaming-scrubber fixture.

Only the module and SPEC are model inputs; keep this file outside its workspace.
Assertions target the published interface, never source text or private fields.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
from pathlib import Path
import unittest


TAG_NAMES = ("think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD")
LIMITATIONS = [
    "Checks the published frozen-module contract, not the production agent, TTS, or UI integration.",
    "Finite deterministic stream cases do not prove every possible chunking or malformed/nested-tag policy.",
    "Historical source provenance and local task exposure do not establish model-training non-exposure.",
]


def load_candidate(workspace: Path):
    """Import exactly the standalone candidate from the supplied workspace."""
    path = workspace.resolve() / "think_scrubber.py"
    spec = importlib.util.spec_from_file_location("ultra_independent_candidate", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load candidate: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.StreamingThinkScrubber


def evaluate(scrubber_class) -> dict:
    """Run public behavior checks against a supplied implementation."""

    class IndependentContracts(unittest.TestCase):
        def render(self, scrubber, deltas):
            parts = [scrubber.feed(delta) for delta in deltas]
            parts.append(scrubber.flush())
            for part in parts:
                self.assertIsInstance(part, str)
            return "".join(parts)

        def test_response_lifecycle(self):
            # SPEC 3/4: all flush exits must isolate the subsequent response.
            preludes = (
                (["Previous visible prose."], "Previous visible prose."),
                (["Visible partial prefix <"], "Visible partial prefix <"),
                (["Heading.\n  <think>unfinished private tail"], "Heading.\n  "),
            )
            for prelude, expected_prelude in preludes:
                for name in TAG_NAMES:
                    with self.subTest(prelude=prelude, next_tag=name):
                        reused = scrubber_class()
                        self.assertEqual(self.render(reused, prelude), expected_prelude)
                        self.assertEqual(reused.flush(), "")
                        opening, closing = f"<{name}>", f"</{name}>"
                        deltas = [opening[:3], opening[3:], "private thought",
                                  closing[:4], closing[4:], "Public response."]
                        self.assertEqual(self.render(reused, deltas), "Public response.")
                        self.assertEqual(self.render(reused, deltas), "Public response.")

        def test_existing_stream_contract(self):
            # SPEC 1/2/3/5: a repair cannot suppress valid prose or discard tails.
            cases = (
                (["Ordinary ", "prose.", ""], "Ordinary prose."),
                (["Use <think> tags in this example."], "Use <think> tags in this example."),
                (["Before <think>private</think> after."], "Before  after."),
                (["<unknown>visible</unknown>"], "<unknown>visible</unknown>"),
                (["Visible </think> \nreply."], "Visible reply."),
                (["The comparison is <"], "The comparison is <"),
                (["The marker is <thi"], "The marker is <thi"),
                (["<think>private unfinished"], ""),
                (["Header\n  <think>private", "</think>Visible"], "Header\n  Visible"),
            )
            for deltas, expected in cases:
                with self.subTest(deltas=deltas):
                    self.assertEqual(self.render(scrubber_class(), deltas), expected)
            for name in TAG_NAMES:
                mixed_name = name.swapcase()
                for tag_name in (name, mixed_name):
                    opening, closing = f"<{tag_name}>", f"</{tag_name}>"
                    for cut in range(1, len(opening)):
                        with self.subTest(tag=tag_name, opening_cut=cut):
                            deltas = [opening[:cut], opening[cut:], "private",
                                      closing[:3], closing[3:], "Visible"]
                            self.assertEqual(self.render(scrubber_class(), deltas), "Visible")
            for pending in ("<think>private unfinished", "<thi"):
                with self.subTest(reset_after=pending):
                    scrubber = scrubber_class()
                    self.assertEqual(scrubber.feed(pending), "")
                    self.assertIsNone(scrubber.reset())
                    self.assertEqual(self.render(scrubber, ["Fresh visible text."]), "Fresh visible text.")

    output = io.StringIO()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(IndependentContracts)
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    return {
        "tests_run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "successful": result.wasSuccessful(),
        "output": output.getvalue(),
        "limitations": LIMITATIONS,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    result = evaluate(load_candidate(args.workspace))
    print(json.dumps(result))
    return 0 if result["successful"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
