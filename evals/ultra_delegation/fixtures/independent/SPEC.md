# Streaming text scrubber repair

Repair `think_scrubber.py` and add your own standard-library regression tests.
This is a frozen historical Python module, supplied as a standalone code-repair
task. Preserve its public interface and the behavior below. Summarize the change
and the tests you ran. No third-party dependencies are required.

## Public interface

```python
from think_scrubber import StreamingThinkScrubber

scrubber = StreamingThinkScrubber()
visible = scrubber.feed(delta)  # str -> str
tail = scrubber.flush()        # -> str
scrubber.reset()               # -> None
```

`feed()` is incremental: its returned strings are immediately displayed and
cannot later be retracted. Empty deltas are allowed. A response's visible text
is the concatenation of its `feed()` results and final `flush()` result.

## Required behavior

1. Hide reasoning enclosed by the existing case-insensitive tag names: `think`,
   `thinking`, `reasoning`, `thought`, and `REASONING_SCRATCHPAD`. Opening and
   closing tags can be split across deltas. An opening tag at stream start or
   after a newline (including indentation) starts a hidden block. An unfinished
   hidden block contributes no visible tail at end of stream.
2. Preserve ordinary text exactly. A mid-line literal mention of an opening
   tag, such as `Use <think> tags in this example.`, remains visible. A complete
   opening/closing pair present together is hidden even mid-line. Preserve the
   existing removal of orphan closing tags and their following whitespace.
   Do not introduce new tag names or attempt nested/malformed-tag semantics.
3. A potential tag prefix is held until a later delta resolves it. If a stream
   ends outside a hidden block, `flush()` returns the held partial text literally.
   A subsequent `flush()` with no new input returns an empty string.
4. `flush()` ends one model response. The same object may immediately receive a
   new response without a call to `reset()`. That response must behave as if it
   started on a fresh instance, regardless of whether the preceding response
   ended with prose, a partial tag, or an unfinished hidden block. Text from one
   response must not affect the next response's boundary classification.
5. `reset()` discards all pending state and starts a fresh response. It must
   continue to work both inside an unfinished block and after a partial tag.

The repair is limited to this supplied module. There is no model API, service,
filesystem, account, billing, or production-runtime change to make.
