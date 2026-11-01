# Android Secure Fill Simplification

## Status

Done

## Goal

Remove app registration and signer trust policy under the operator-controlled installed-app assumption. Keep Android private entry usable with existing website vault accounts and audit restrictions for concrete value.

## Current Behavior

- Installed apps need no registration. Android inspection receives the account website for shared vault matching.
- The worker assigns roles using labels and screen context; password metadata is a hint.
- Native and WebView editable accessibility nodes share private filling. WebView screenshots remain fully masked.
- Shared services own private cards, vault selection, staged credentials, OTP and continuation.

## Target Data Shape

- Android destinations retain their package name; certificate pinning and `PAL_ANDROID_LOGIN_APPS` are removed.
- Android `login_inspect` accepts the account website for shared vault matching. This is account context selected by the worker, not an app authorization list. Browser origins remain derived from the page.
- Existing saved rows tolerate extra historical signer metadata without relying on it.

## Milestones

### 1. Remove app trust configuration — complete

- Remove allowlist/signature collection and validation across adapters, helper, scripts and tests.
- Thread Android account website through inspection; normalize its HTTPS origin and preserve shared browser account matching.
- Update shared authentication guidance and Android-specific mechanics in their existing owners.

Exit: an unregistered installed app can inspect and fill through the private UI with website account reuse.

### 2. Audit and validate remaining restrictions — complete

- Remove password-flag authorization; retain metadata for model role selection and private masking.
- Review WebView exclusion, stale binding, ownership, timeouts, payload limits and helper authentication. Record concrete retain/remove decisions.
- Verify focused backend/browser/native regressions, rootless helper build and connected-device private fill. Update architecture and plans; commit locally and clean owned resources.

Exit: removed controls have targeted coverage; remaining limitations and safety invariants are documented with reasons.

## Tests

- Unconfigured native app, HTTPS account context, missing password flag, private credential/OTP filling and shared vault reuse.
- Existing changed-target, cancellation, ownership release and uncertain-fill/no-replay regressions.
- Browser secure-entry regression and rootless connected-device proof; preserve personal app data.

## Validation Commands

Use focused backend tests with a named scratch database, `npm run build`, `npm run lint`, `./scripts/dev-local android-up`, and `./scripts/dev-local android-secure-smoke` as appropriate. Rebuild the dev backend for PWA testing after checks pass.

## Overall Exit Criteria

- No trusted-app configuration or certificate policy remains in live Android filling.
- Model-visible changes are minimal; account website is distinct from native destination binding.
- Audit, dev verification, resource cleanup and local commits are complete.

## Restriction Audit

| Control | Decision and reason |
| --- | --- |
| App allowlist, signing certificates, operator origin map | Removed. Installed-app trust belongs to operator installation policy. |
| Password flag required for password/PIN | Removed. Apps may expose visible passwords or incomplete metadata; the worker assigns semantic roles. All editable values remain private. |
| WebView field prohibition | Removed for editable accessibility nodes supporting `ACTION_SET_TEXT`; no separate typing channel needed. |
| Account website | Retained as explicit HTTPS context for the existing website vault. It is not verified against embedded content. |
| Exclusive worker ownership and native package binding | Retained to prevent concurrent workers or app switches from misdirecting a pending private submission. |
| Session/window/node/geometry checks and ten-minute refs | Retained to reject changed selections while private input is pending. Fresh inspection restores operation. |
| Editable action requirement | Retained because private entry needs a supported value-setting primitive without keyboard/clipboard exposure. |
| Masked text/screenshots and full WebView mask | Retained to keep submitted values out of model observations. Full WebView masking limits visual navigation; sanitized accessible elements remain available. Finer masking is separate work requiring evidence. |
| Helper authentication, bounded transport and value lengths | Retained for a private credential channel and bounded resource use; no per-app policy remains. |
| No retry after uncertain/partial fill | Retained to prevent duplicate secret dispatch. Read-only capture may retry. |
| Transient OTP, cancellation, late submission checks | Retained from shared private-entry behavior. |
| Payment cards, device unlock, biometrics/passkeys | Remain outside this login implementation; supporting them requires different semantics or platform APIs. |

## Validation

Connected-device proof passes native and WebView username/password/OTP fills, Unicode, missing password metadata, stale-ref rejection, observation privacy and Mobile MCP handoff. Native field masks and full WebView masking were visually checked. Dev backend and Android sidecar are rebuilt and healthy. Both real Task/interaction-worker journeys pass on gpt-6.1-terra: new private username/password/OTP and saved username/password reuse with a fresh private OTP. They use the real private HTTP/shared vault service path with a synthetic vault endpoint; no personal accounts were touched. Focused checks passed: 12 Android/shared-login/worker/skill tests, nine Android/browser private-entry E2E tests, backend build and lint/boundary checks.


Cleanup verified: scratch databases, fixture app and copied scripts/images were removed; USB stay-awake was restored to 15. The idle helper forward was removed by exact identity. Masked local proof images (72 KB) remain as evidence. No disposable task images remain; active dev images (~7.5 GB total Docker image storage), persistent volumes and shared build cache (~14.0 GB) are retained. Existing Mobile MCP forwards are outside task ownership.
