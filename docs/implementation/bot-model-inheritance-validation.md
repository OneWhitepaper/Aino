# Bot model inheritance validation

Date: 2026-11-11. Scope: creating a Bot with a selected profile as its clone source.

## Behavior

Creation snapshots the source's saved default, rather than the model temporarily selected in
an existing conversation. Aino model preferences remain scoped to account, API origin, mode,
connection and profile; the SDK copies that preference after successful profile creation.
Provider/custom model configuration and endpoint definitions use the existing profile clone.
The shared-account option keeps its existing default-home authorization pool semantics; with
sharing disabled, copyable authorization comes from the selected source.

After creation, the source and new Bot can change their defaults independently. An unavailable
credential, model or subscription is still a real authorization failure, not permission to borrow
the workspace currently hosting an RPC.

## Repairs

- Credential/optional-section mirroring now runs in the explicit clone source's existing complete
  runtime scope. A comment-only source dotenv or absent local auth store cannot be filled from a
  different RPC-host workspace. Fresh creation retains its existing launch-source behavior.
- Opening Capabilities/MCP can materialize a draft. Explicit model selection is now committed by
  the final Create action through the existing guarded `profiles.configure` flow. Changing the
  model after materialization, or clearing it back to inheritance, no longer uses a stale early
  pin. Failed/incomplete writes and declined confirmation keep the dialog and do not send the intro.
- Changing the materialized draft's clone/share/empty-skills base asks through the existing
  confirmation dialog before removing that draft. Deletion must succeed before the new choice
  applies. Model-only edits retain configured MCP capabilities.
- Draft resets use the captured creation ledger, owner, target and generation; a workspace switch
  cannot delete another source's same-named Bot. Old model/readiness completions cannot close a
  replacement creation dialog. Saving disables the form; retries reuse the existing draft.

New boundary contracts were demonstrated failing before their fixes. No new model tool, profile
manager, credential pool or execution service was introduced.

## Fresh evidence

| Check | Result | Log basename |
| --- | --- | --- |
| Profile clone, endpoint/credential scope, guarded configuration, canonical binding and Bot defaults | 187 passed; 7 other-host cases skipped | `aino-bot-inheritance-backend-final.log` |
| SDK platform defaults/binding, draft creation, model picker/editor and locales | 183 passed | `aino-bot-inheritance-ui-final.log` |
| Static repository checks | 14 checks passed; zero health findings | `aino-bot-inheritance-check.log` |
| Desktop renderer/Electron/E2E type checks | Passed | `aino-bot-inheritance-typecheck.log` |
| Changed frontend/E2E ESLint | Passed | `aino-bot-inheritance-lint.log` |
| Desktop build and development main/preloads | Passed | `aino-bot-inheritance-build.log`, `aino-bot-inheritance-dev-bundle.log` |
| Native Aino and custom API creation through first response | 2 passed on final production build | `aino-bot-inherit-native-final-isolated.log` |
| Native preset DeepSeek creation through first response | 1 passed on same production build | `aino-bot-inherit-native-provider-final.log` |

Native tests use isolated accounts/homes, synthetic credentials, loopback services and outbound
guards. Aino's saved GLM catalog ID deliberately differs from the API default; the test checks the
new Bot's scoped preference, stored model metadata, actual native binding input and fixture reply.
The API test consumer uses temporary leases and maps catalog entries to one synthetic provider;
this is model-inheritance acceptance, not an assertion about permanent device Keys or a paid LLM.
Custom and preset DeepSeek tests independently witness the actual model and matching synthetic
Authorization at their endpoint, then verify the rendered response and stored profile/session.

Initial native fixture failures were diagnosed rather than hidden: menu label capitalization,
shared synthetic-account SMS cooldown, and use of the legacy `openai` alias with an unsupported
model-level endpoint override. Final cases use the actual current menu, per-case API state, and
the registered DeepSeek preset's supported endpoint variable. Production limiters and provider
resolution were not weakened to satisfy a fixture.

No real user profile was edited, no paid-provider request was made, and no installer, commit or
deployment was produced by this validation.
