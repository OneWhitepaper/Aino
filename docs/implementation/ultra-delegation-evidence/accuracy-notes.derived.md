# Independent accuracy notes — derived handoff summary

This is an editorial synthesis of the saved independent audits, not model output,
new runtime validation, or a corrected replacement answer. The originals remain
unchanged. Source hashes are in `provenance.json`. Finding numbers below are
one-based within the **132101** child arrays; older runs used different findings.

## Acceptance outcome

| Dimension | Latest full run: 132101 | Parent-only replay: 140532 |
| --- | --- | --- |
| Child evidence | Three natural completions; 25 findings, 16 `confirmed`, nine `needs_verification`; one schema repair | Same three original strings reused; no new child calls |
| Delivery | One complete batch notification; real parent request followed the last child completion by about 34 ms | Source input prefix and evidence preserved, according to the independent transport audit |
| Natural parent final | Failed: cumulative input cap; interrupted empty final event | Passed: natural final at 433.356 seconds; run ended at 436.66 seconds |
| Whole-task budget acceptance | Failed | Not tested: fresh parent-only budget excludes source work |
| Final accuracy | Not evaluable: tool-argument drafts are not a final answer | Failed overall despite some improved qualifications |
| Three groups and Top 3 | Not evaluable | Present; visible body counts 384/385/346; raw Markdown counts 392/401/356 |

The original request did not define whether Markdown, headings, or English
identifiers count toward “400 characters.” Visible body length satisfies 400;
strict raw Markdown body length exceeds it by one in group 2. Neither convention
should be silently selected after the run to declare an unconditional pass.

## Failures and boundaries to preserve

1. **Provenance rollback is overconfirmed in the replay final.** Child 0 finding 2
   shows local restoration of `previous_summary` without a corresponding local
   restoration of the user-origin marker (`context_compressor.py:4705–4735,
   4844–4872`). But the complete scan is passed to `_summarize_window` at
   5132–5134, whose external implementation was outside the six-file snapshot.
   Later scans can also recompute provenance. The final claim that later summaries
   reuse a stale marker is not established by the allowed evidence. Retain a
   conditional local mismatch requiring dispatch/consumer validation, not a
   confirmed end-to-end corruption claim.

2. **Replay display and actionable task views have different intended purposes.**
   Child 0 finding 6 and the final correctly observe that one view hides a replay
   row while another can return a user-shaped task view. However,
   `context_compressor.py:4299–4303` explicitly distinguishes actionable tasks
   from genuine inbound user messages, and line 4550 says display provenance must
   not alter task anchoring. An erroneous consumer or duplicated real user action
   was not shown. The differing return values alone do not establish a bug.

3. **Missing `capabilities` does not prove failed restoration.** Child 2 finding 1
   claims confirmed capability loss because the snapshot lacks the field and the
   fallback passes `None` (`model_switch.py:15–51`). The external `switch_model`
   contract may preserve, recompute, or clear it; that contract was not inspected.
   The failed source run's tool draft repeated the overclaim. The replay final
   correctly moved this to an uncertainty. This improvement must not erase the
   original child's classification error.

4. **Abort preserves preprocessed messages, not necessarily original bytes.**
   The source parent's draft said “return unchanged.” The fixture explicitly keeps
   tool-result pruning across abort (`context_compressor.py:5050`) and stale-tail
   demotion before summary failure (5100–5103). The replay's “preserve messages” is
   narrower, but should not be interpreted as retaining every original tool body.
   These deliberate preprocessing steps are not evidence of a new data-loss bug.

5. **Configuration facts need their branch conditions.** Child 1 findings 3 and 8,
   also shortened in the final, omit two conditions: the >10 warning requires an
   explicit config entry (`delegate_tool_config.py:103`); an explicit
   `override_api_mode` wins over provider-change recomputation (531–539). No numeric
   configuration ceiling does not mean unlimited actual worker concurrency.
   `int(inf)` raises locally only if such a value reaches the config reader; real
   parser reachability remains unverified. Ignoring the legacy key is a stated
   migration behavior, not automatically a defect.

6. **Local ordering is not a demonstrated unrecoverable session failure.** Child 2
   findings 2 and 4 show changes made before later operations or cleanup boundaries.
   They do not establish that helpers can raise in the claimed paths, that outer
   recovery is absent, or that profile state actually leaks. The replay uses
   “may” for post-switch failure, an improvement, but its “confirmed” grouping
   still needs this boundary. The seen-before-switch behavior is expressly one
   attempt per config edit (`model_switch.py:441`), rather than an accidental
   failure to retry. Invalid-image text differences require an input-admission
   contract before claiming real restored history is broken.

The replay appropriately leaves cancellation/queue completion races, actual worker
admission, inflight callback ordering, and capability restoration dependent on
external code. Valid JSON and in-range citations did not guarantee factual
classification: child 2's global limitations promise uncertainty for external
exceptions, while some individual findings are marked `confirmed`.

## Efficiency and next diagnostic boundary

The source children used no character-counting tools. The parent received the
complete batch, then used 21 `read_file`, 19 `search_files`, and one `execute_code`
call, alongside its original delegation. The one execute call counted draft
lengths; all three drafts exceeded 400 under its own raw-character convention.
There was still no final at the input cap.

The replay used 17 `read_file`, four `search_files`, and four `execute_code` calls;
all four execute calls checked draft character counts. A second candidate was
already below 400 before later revisions caused two more checks. This is repeated
formatting work and imperfect evidence synthesis, but it did finish naturally; it
is not the earlier child loop that exhausted its turn allowance.

The unresolved product question is how to achieve reliable natural completion and
useful, accurate synthesis under the **entire** task budget. These observations
do not show that batch delivery, schema validity, a parent-only replay, or passing
regressions has solved that question. Single historical runs are not randomized
comparisons; changes in child latency, cache state, and sampling confound causal
speed or cost claims.
