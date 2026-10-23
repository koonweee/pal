# External Password Vault and Browser Login

## Status

Done — implementation and independent verification. Hosted-vault and real-account acceptance require the operator setup listed below.

## Goal

Let Task and Worker agents discover matching credentials, request secure entry in the PWA, and fill existing browser login fields without credential values entering login-tool arguments/results, chat, or execution files. Keep existing browser and shell control. Use hosted Bitwarden with a dedicated Pal account and service-private automatic unlock. Build a small deterministic Playwright inspector/filler; do not fork an extension.

## Current Behavior

- Agent-service owns NestJS/Mastra and private storage; execution owns Chromium, shell, and shared `/home/pal`. Execution cannot reach private backend APIs or service-private storage.
- `backend/src/browser/browser.service.ts` already connects to shared Chromium via Playwright/CDP and maintains task/worker tab ownership. Generic browser commands execute through agent-browser inside execution.
- `browser-tools.ts` returns native text/image tool content. Login inspection must remain a direct multimodal tool, excluded from JSON-only code mode.
- LoginService provides direct inspection/request/fill tools to Task/Worker. BitwardenService runs the pinned supported CLI API in agent-service; execution has no vault configuration or private storage.
- The PWA displays secure request forms and annotated previews for the selected Task. PostgreSQL owns secret-free requests, notification delivery state and private masked previews.

## Decisions and Boundaries

- Hosted Bitwarden Password Manager is the canonical store and URI matcher. A dedicated account limits the material available to Pal. Use its supported CLI-backed Vault Management API, bound to loopback inside agent-service. No browser extension or custom cryptography.
- API authentication and vault decryption are distinct. Account API credentials and automatic-unlock material are configured only for agent-service, never shared home or execution. CLI state belongs under service-private storage. Missing configuration disables vault operations with safe status; it does not prevent the application starting.
- Reuse Bitwarden URL matching. New records use Host matching and HTTPS sites; model cannot broaden scope. Revalidate the chosen record against the current frame URL before retrieval/filling. No matching by arbitrary model-provided domain or substring.
- Browser inspection extracts native input metadata without reading values. The model assigns roles and selects refs; backend checks ownership, freshness, native type/purpose, editability and one frame/document. Password destinations require password inputs. Support ordinary DOM and open shadow roots.
- Browser references bind task/worker, target, frame/document, and actual DOM elements. Revalidate at fill time, fail when stale, and never fall back to typing into current focus or arbitrary text fields. Existing browser control remains available under the accepted model trust boundary.
- Trusted backend fills directly through Playwright/CDP. Values do not enter agent-browser command arguments, shared temp files, tool outputs, SSE, chat, request metadata, errors or logs. The website and browser necessarily receive the selected credential. Generic browser/shell access is not a sealed security boundary. Ordinary DOM snapshots include populated usernames; guidance identifies submit controls before filling and uses masked login inspection while the form is populated.
- Inspection foregrounds the caller's pinned tab for reliable headful capture and returns structured targets/accounts plus a masked annotated viewport screenshot by default. Labels correspond to backend-issued targets. Temporary overlays have no layout/focus effect and are removed in finally. Mask detected credential inputs even if populated. Store previews privately and expose them through a no-store PWA endpoint; bound retention. No automatic screenshot publication or incoming-file materialization.
- PWA credential submission goes directly to the backend, never chat. Saved/cancelled events carry only request IDs, origin and status. Notify the owning Task and resume with fresh inspection; workers report pending input to their parent. Reuse pending requests, return stable completion results for retries, and reject expired pending submissions.
- Saved credentials may fill without repeated user approval. Filling does not submit or assert authentication; existing browser tools navigate, click Next/Sign in, and assess results.
- Full vault management remains in Bitwarden. Initial PWA supports collecting and replacing a matching credential. Vault TOTP generation, push approval, passkeys, signup/password generation and broad site-specific rules are deferred. PWA verification-code entry and staged-login reuse are specified in [Secure Entry and Verification Codes](secure-entry-otp.md).

## Target Data Shape

The current input-selection contract is specified in [Model-Selected Secure Fields](model-selected-secure-fields.md).

- Durable login request metadata: UUID, task ID, verified origin, status (pending/saved/cancelled), optional selected vault item reference, timestamps. Never username/password. A stable request ID supports retrying a save without duplicate vault records; reconcile any ambiguous provider outcome before retry.
- Private inspection metadata: inspection reference, owner, verified origin, input references/metadata, screenshot reference and expiry. DOM handles are ephemeral and invalid after backend/browser restart; retained previews remain display-only.
- Minimal first-party endpoints: list pending requests/recent inspections for the active task, get masked preview, submit username/password/label for an existing request, cancel request. Use existing origin guard and first-party OpenAPI conventions. Credential request bodies are never stored as general idempotency payloads or echoed by validation.
- Metadata-only `login.updated` event invalidates PWA snapshots. Task notification uses existing runtime handoff mechanisms and can be retried without repeating the vault write.
- Tools: `login_inspect()`; `secure_entry_request({fields})`; `secure_fill({fields, accountId?})`. Runtime supplies identity. Return bounded error/status codes and opaque account references with safe labels. No general vault-read/export tools.

## Milestones

### 1. Supported Bitwarden Client and Private Configuration

Status: validated with HTTP/process fixtures and the installed CLI binary; hosted-account acceptance awaits configuration.

Implementation tasks:

- Implement one focused Bitwarden integration using the supported API; supervise its pinned CLI process with loopback binding, origin protection, bounded timeouts, safe errors and service-private environment/state/temp paths.
- Document hosted dedicated-account setup and automatic unlock in `.env.example` and deployment docs. Install the pinned CLI only in the agent-service image and forward configuration only to that service.
- Implement status, sync/matching, retrieval and create/update needed by login collection. Keep secret-bearing responses inside the service integration.

Exit criteria:

- A disposable provider fixture proves matching and create/read/update flow, safe failure and configuration handling. Application starts without Bitwarden configured. No vault configuration or files appear in execution.
- A real Bitwarden account is not required for independent implementation. Missing account/API/unlock inputs are accumulated as human setup blockers.

### 2. Deterministic Inspection, Annotated Preview and Filling

Status: validated on synthetic pages, live Apple/Amazon forms, and development execution Chrome with separate worker tabs.

Implementation tasks:

- Add trusted access to the actual pinned task/worker page using existing target ownership rather than selecting the first page or global active tab.
- Implement fresh DOM inspection and bounded opaque target references; validate origin/document/elements before filling and between stages. Serialize inspection/fill per browser identity where needed.
- Add credential masking and temporary annotations to viewport screenshots; persist bounded service-private previews for the PWA without exposing input values.
- Add synthetic login pages covering combined and multi-stage forms, a comment input, competing signup form, stale/replaced targets and frame origin boundaries.

Exit criteria:

- Synthetic tests fill intended controls, leave comment/signup/incorrect-origin fields untouched, reject stale handles, and prove screenshot masking and overlay cleanup. Returned metadata/logged errors contain no dummy credential values.

### 3. Durable PWA Requests and Agent Tools

Status: validated through API/database/browser integration and focused PWA behavior tests.

Implementation tasks:

- Add request repository/schema/migration and focused login service. Keep vault writes and task notification separated so delivery failure cannot duplicate credentials. Reuse pending requests and reconcile repeated submissions.
- Wire three tools to Task/Worker browser identities. Exclude inspection from JSON-only code mode and keep Main a router. Add concise shared execution guidance on login tools, refusal, pending requests and verification after filling.
- Add first-party DTO/controllers, safe task-resume notification, metadata-only SSE invalidation and generated OpenAPI/frontend contracts.
- Add a PWA login panel for the selected Task: pending request form, save/replace/cancel status and recent annotated inspection previews. Keep secret drafts in component memory, clear after submission/close and avoid service-worker/history/local-storage caches. Include active credential editing in reload safety.

Exit criteria:

- A user can save or cancel from the PWA, reload and recover pending status, and the owning Task receives secret-free completion. Screenshot previews match inspection metadata. Completed requests cannot be resubmitted as new vault writes.

### 4. Integrated Verification and Review

Status: independent checks pass; development backend/PWA are updated and healthy. Operator-dependent acceptance is recorded below.

Implementation tasks:

- Run focused backend/database, browser and frontend tests; build/lint/check boundaries/OpenAPI/UI ownership and unused frontend scope as applicable.
- Verify synthetic login through the deployed development service path using dummy credentials and the supported Bitwarden API fixture; inspect all transcript/output surfaces for the dummy values.
- Inspect Apple (`account.apple.com`/actual redirected login frames) and Amazon (`www.amazon.com`/actual login URL) without changing account state. Exercise actual login only with existing authorized test credentials; defer CAPTCHA, 2FA, dedicated vault setup and account provisioning to the final blocker list.
- Review diff for overengineering, accidental secret persistence, image retention and incorrect frame matching; update architecture/docs/plan status and commit coherent verified work locally. No push or production deployment without a separate request.

Exit criteria:

- Automated synthetic flow, annotated screenshots, PWA collection and safe task resumption pass. Apple/Amazon field inspection evidence is recorded; actual authentication is either verified or explicitly listed as a human blocker. No unverified acceptance is marked complete.

## Tests

- Provider contract fixture exercises supported REST shapes, URL filtering, lock/unavailable responses, automatic unlock and sanitized errors.
- One browser suite proves target eligibility, multi-stage refresh, competing comment/signup controls, document replacement/origin mismatch, screenshot masking/cleanup and worker tab ownership.
- Focused database/API integration proves pending-request deduplication, save/cancel lifecycle, secret-free persisted/event records, repeat submit behavior and task notification recovery.
- Focused PWA behavior proves request form submission stays out of chat/storage, clear-on-close/success, pending snapshot recovery and annotated preview rendering. Add one production PWA cache/reload regression only if its policy changes.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- <focused login integration tests>
npm run openapi:generate
cd ../frontend
npm run api:generate
npm run check
npm run test:unit -- <focused login tests>
npm run check:ui
npm run trim
```

Add a focused deterministic browser verification command using an isolated synthetic page and dummy provider. Run existing relevant browser/runtime regression checks when their paths change. Use `./scripts/dev-local rebuild` for backend changes; preserve execution desktop unless image changes require `execution-rebuild`.

## Overall Exit Criteria

- Bitwarden owns credentials and matching; execution has neither vault unlock material nor broad vault access through the new tools.
- Credential collection/filling bypasses model context and shared files; annotated inspection is available to the model and PWA with credential inputs masked.
- Existing browser/shell capabilities and persistent sessions remain available.
- Synthetic acceptance and relevant checks pass. Apple/Amazon inspection and any real-authentication limitations are reported accurately.
- Required human setup/input is accumulated and presented together at completion. No account signup, purchase, credential creation, or external communication is performed on the user's behalf without the required input.
- Documentation and configuration reflect the implementation; focused changes are reviewed and committed locally.

## Human Blockers and Acceptance Evidence

Verified:

- Backend: focused login/provider/browser/discovery/runtime suites pass (22 service/unit cases and two API integration cases). HTTP/process fixtures exercise create/update, repeated-save reconciliation, private environment/temp paths, concurrent startup/unlock and sanitized failures. API tests exercise save/cancel, secret-free records/results/events, PNG delivery and task notification retry without another vault write.
- Synthetic browser: paired username/password, username-first/passkey hint with a hidden later password, password-only, competing signup/comment fields, owner/frame/document/URL binding, altered password type, clipped later-stage fields, accessible username hints, declared OTP/card-security purposes, masked/revealed pixel equality and overlay cleanup pass.
- Actual development execution: two worker sessions resolve separate pinned Chrome tabs. Trusted fill changes the intended fields, leaves the other tab/comment untouched and returns no dummy values. Headful inspection foregrounds its pinned tab to avoid background screenshot capture hanging.
- Apple Store: the live development sign-in identifies a username without autocomplete using its identifier metadata and accessible label, while its later password is clipped by a collapsed container. A regression covers inspection and fill-time clipping checks. The CLI process fixture uses the actual status template envelope and verifies reuse of an unlocked vault.
- Apple: public `account.apple.com/sign-in` inspection identifies its username-first stage in the `https://idmsa.apple.com` frame. Amazon: public `www.amazon.com/gp/sign-in.html` identifies its username-first field on `https://www.amazon.com`, using a general passkey hint and hidden-later-password rule. No site-specific selectors were added. Masked PNGs and a metadata-only report are local ignored artifacts under `.local/login-acceptance`.
- PWA: type checks, focused login/reload-safety tests, UI ownership, unused-code checks, generated API check and staged production build pass. Direct save uses the API, status refresh retains drafts, close/save clears them and local storage receives no draft. Existing API network-only policy remains unchanged.
- Backend build/lint/adapter boundaries and OpenAPI checks pass. Development migration is applied; backend, execution and gateway are healthy. Execution retains its running desktop/profile and has no Bitwarden environment, private mount or CLI. Installed service CLI reports 2026.10.0. Changes remain local; production is unchanged.

Operator-dependent acceptance (unverified):

1. Development has dedicated Bitwarden configuration; a private probe confirms an unlocked real CLI and a successful URL-matching read. Actual hosted credential create/update and account filling still require PWA entry; no credential values were inspected.
2. Collect Apple/Amazon account credentials through the PWA after vault setup. Full authentication and later password stages require authorized accounts and any CAPTCHA, second factor or account-verification interaction. Public inspection did not submit credentials or change account state.

Accepted limitation: ordinary browser snapshots can expose populated usernames, and generic browser/shell/computer controls can access browser secrets. Shared guidance identifies submission controls before filling and uses masked login inspection while populated. The new login pipeline keeps values out of model arguments/results and application metadata; it does not seal all existing browser capabilities.
