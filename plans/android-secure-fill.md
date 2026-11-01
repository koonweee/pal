# Android Secure Fill

## Status

Planned. All milestones remain open. Implement before the [Android/browser/computer comparison](android-browser-computer-benchmark.md).

## Goal

Support native Android username/password and verification-code filling through Pal's existing Bitwarden and private-entry workflows. Keep credential policy, account selection, staged entry, request state and notifications shared with browser login. Use a small Android adapter for observation, destination validation and direct field filling.

Scope: development acceptance on the USB phone connected to this Mac, using container ADB. Production deployment remains a separate task in the deployment repository. Payment entry, device unlock, biometrics, passkeys and a full Android autofill provider are deferred.

## Current Behavior

- [Android Mobile MCP](android-mobile-mcp.md) provides worker-only phone control through `backend/src/android/`, the `backend/android/` sidecar and `scripts/dev-local`. The host selects one device, serializes operations and reserves it for an interaction worker.
- `android_type` enters ordinary text into current focus. Android guidance currently requires manual credential/code entry. Android secure filling is unimplemented.
- `LoginService`, `LoginRepository`, `BitwardenService`, `LoginBrowser` and `login-tools.ts` own browser secure entry. Private cards, staged entry, account choice, notification/recovery and transient OTP handling already exist. See [staged login](staged-login-entry.md) and [architecture](../architecture/backend.md#browser-secure-entry).
- Browser refs bind caller, page, document and elements. Android needs equivalent ownership and freshness checks appropriate to native fields. Android app identity also needs an explicit trusted relationship to the website used for vault lookup.
- Mobile MCP's model-facing element output omits richer native field properties. Direct native-node filling and coexistence with its automation connection must be proven on the actual phone.

## Target Data Shape

- Keep one owner for credential policy, private cards, staged account selection and request lifecycle. Introduce a narrow destination-adapter contract only where browser/Android behavior differs: inspect, validate/select, fill and binding lifetime.
- Inspected native fields expose opaque refs, role-relevant metadata, verified app identity and a masked preview. Values remain private. Bind refs to task/worker, device, helper session, app/window and native node; reinspection, replacement, expiry and ownership changes invalidate them.
- Durable request/inspection metadata must distinguish browser and Android targets, including enough trusted identity to recover safely after restart. Reuse existing records; add a small migration only if needed to encode that distinction. Never infer the target from website origin alone or persist live native handles.
- Reuse existing HTTPS vault matching through an operator-controlled package/signing-identity to website mapping. The model cannot supply or change trusted mappings. Add configuration to `.env.example` when implemented; choose one concrete representation.
- Keep the model surface small: extend `login_inspect` with an Android target selector, defaulting to browser. `secure_fill` and `secure_entry_request` infer the target from opaque refs. Keep device choice in host code. Reject browser action arguments and payment roles for Android. Native session controls/preferences need explicit semantics; do not claim browser persistence controls apply to apps.

## Milestones

### 1. Prove native inspection and direct filling

Implementation tasks:

- Build a small Java/Kotlin UI Automator/instrumentation helper launched over authorized ADB without root. Pin dependencies; keep JDK, Gradle and Android SDK in a Docker build stage. Package only runtime artifacts in the existing Android sidecar.
- Implement only private field inspection and direct validated-node text setting. Collect password/input-type flags, editable/enabled/visible state, labels/resource IDs and app/window identity where Android exposes them. Treat missing metadata as unknown.
- Use an authenticated private channel over ADB for requests. Keep credentials out of command arguments, shell text, clipboard, persistent files, instrumentation arguments, logs and diagnostic responses. Do not expose a public phone listener.
- Add a minimal native fixture for username/password and staged identifier/password/OTP screens. Prove filling with synthetic secrets, including Unicode, without submitting automatically.
- Verify helper start/stop, connection loss and serialized coexistence with Mobile MCP. Use supported APIs and document their integration gap. If simultaneous automation sessions conflict, prove bounded handoff and safe reconnection before continuing.
- Inspect the intended Amazon/Facebook native login paths when accounts/setup permit. Record whether native fields are accessible and whether login moves into a WebView or another app. Embedded browser credentials require verified domain binding; unsupported identity is a handoff. Do not infer a domain from screenshots, labels or an app's resource IDs.

Exit criteria:

- The unrooted phone exposes useful field metadata and accepts a synthetic secret on the selected native node. The following observation is masked.
- Mobile MCP navigation still works before and after helper operations. No target-app modification is needed. Any unsupported live login paths and automation conflicts are documented before expanding integration.

### 2. Share the secure-entry workflow

Implementation tasks:

- Extract the browser destination assumptions from `LoginService` while preserving its current behavior. Keep vault access, account matching/selection, private cards, staged credential merging, transient codes, notifications and recovery in their existing shared owners.
- Add the Android destination adapter and trusted app/website mapping. Verify installed signing identity and foreground window/app before credential lookup/fill. Browser-hosted login handoffs require their own verified identity.
- Let the interaction worker assign semantic roles from sanitized metadata and preview. Code requires an editable destination and password metadata for reusable passwords/PINs, rejects incompatible roles, and validates every selected node before writing.
- Revalidate immediately at each native write; never fall back to coordinates or current-focus typing for secrets. Preserve code-ref order. Report a failed/uncertain or partial fill without automatically replaying secret mutations or submitting the form.
- Apply the same phone ownership/serialization to private submissions and model-driven operations. Define bounded reservation while awaiting private entry, cancellation, expiry, worker resume and release. A late submission cannot target another worker's screen. A released or restarted helper requires fresh inspection.
- Reuse browser account-picking and private-entry UI, with target-appropriate identity and copy. Keep native flow state distinct from browser flow state even when both use the same website/account.

Exit criteria:

- The real Task-to-interaction-worker path can reuse a saved synthetic login, collect new private credentials, continue staged entry and fill transient OTP fields on Android.
- Account choice and credential persistence have one shared policy. Existing browser private-entry and staged-login journeys still pass.
- Wrong app/signer/owner, stale node/window, missing password metadata, cancellation and late submissions fail without misdirected filling.

### 3. Protect observations and align guidance

Implementation tasks:

- Sanitize every Android observation route available to the worker, including ordinary `android_inspect` and `android_screenshot` after private filling. Avoid exposing raw Mobile MCP output that bypasses masking.
- Exclude populated editable text and value-bearing metadata; mask all text-entry regions, including unselected fields and sensitive keyboard suggestions. Recheck screen/window consistency around capture and withhold observations when masking cannot be established. Never substitute an unmasked image after masking errors.
- Keep raw hierarchy/screenshot material transient. Reuse private preview retention and metadata notifications; redact error and reconnect paths. Preserve the existing accepted agent trust boundary without claiming protection against a malicious agent with unrelated privileged access.
- Compare shared Task/Worker and authentication skill guidance. Keep common secret-handling/account-choice policy in one applicable source; add only Android inspection, capability limits and recovery to its worker skill.
- Document helper build/lifecycle, supported fields, trusted mappings, manual fallbacks and dev commands. Add configuration examples and generated API updates only where the contract changes.

Exit criteria:

- Synthetic canaries stay out of model observations, tool text, traces, errors, chat and persisted previews, including after fill failure, reconnect and worker resume. Image-level redaction is checked independently.
- Main remains the router, Task coordinates and the interaction worker alone operates the phone. Detailed Android/authentication procedures remain discoverable on demand.

### 4. Development acceptance and handoff to benchmark

Implementation tasks:

- Rebuild the existing dev stack and run model-driven native fixture flows through actual private-entry HTTP submissions and saved-vault filling. Verify post-login state independently of the model's final answer.
- Exercise helper replacement/reconnect and pending-entry cancellation/resume. Preserve phone apps, logins, ADB authorization and protected dev volumes.
- Run one supported live native credential flow when the user/account is available; record manual challenges and unsupported paths. User assistance uses the private UI or device, never chat credentials.
- Record code/helper/image identity, supported app identities and limitations for the dependent benchmark. Mark acceptance evidence accurately; unresolved capability/privacy failures keep this plan incomplete.
- Remove owned fixture apps, synthetic vault entries, scratch records and disposable build/test resources after acceptance. Retain the production helper and active dev artifacts; report retained image sizes after build-heavy work.
- Review and commit scoped work locally. Include the repository-required tool/guidance availability table in the implementation completion report.

Exit criteria:

- Focused checks and actual development flows pass; browser behavior is preserved; benchmark prerequisites and any unsupported app flows are explicit.

## Tests

- One helper/device fixture journey covers direct fill, staged credentials, OTP, Unicode and masked post-fill observation. Use synthetic secrets and independent fixture state checks.
- Focused host cases cover owner/device/app/signer binding, stale refs, role checks, cancellation/late private submission, partial or lost-response handling and observation privacy. Add cases where they enforce different invariants, not a test for every helper method.
- Reuse browser login integration/E2E and frontend private-entry coverage; add frontend tests only for changed target-specific UI behavior.

## Validation Commands

Existing commands, run only as relevant to implementation:

```sh
./scripts/dev-local android-status
cd backend
npm run build
npm run lint
npm test -- test/android.spec.ts test/login.spec.ts test/task-workers.spec.ts test/agent-skills.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts
cd ..
./scripts/dev-local rebuild
./scripts/dev-local android-smoke
./scripts/dev-local status
```

Implementation must add and document a reproducible containerized helper build and synthetic secure-fill device acceptance command. The existing read-only `android-smoke` is insufficient secure-fill acceptance. If first-party API/UI changes, run API generation, frontend type checks and the focused secure-entry browser test using existing scripts.

## Overall Exit Criteria

- Native username/password and OTP flows reuse Pal's shared secure-entry workflow; credential values reach only the trusted backend/helper and intended app.
- Root and a full autofill provider are unnecessary. The helper has a reproducible container build and validated coexistence with Mobile MCP.
- Validated direct-node filling, trusted target matching, bounded ownership and masked ordinary observations are enforced in code. Semantic field-role assignment and authentication-result interpretation remain model judgment.
- Browser regressions pass; development acceptance and cleanup are recorded; the dependent benchmark can exercise actual filling. Production deployment and deferred features remain outside this plan.
