# Model-Selected Secure Fields and Inline UI Prototypes

## Status

In Progress

## Goal

Let the model assign username/password/code roles to inspected input references through one fields contract. Preserve private secret handling and backend destination checks. Then prototype inline PWA request cards in a Kodex app surface using existing Pal components and theme; defer production timeline wiring until UI iteration.

## Current Behavior

- LoginBrowser enumerates masked native inputs; both secure tools accept model-assigned fields. Semantic credential/OTP classifiers are removed.
- LoginService owns saved-account reuse, private filling and PWA requests; code requests retain ordered input refs. Public preview snapshots expose only image references.
- The PWA shows the current preview and entry form in a Logins modal. Canonical chat messages own the public conversation independently of Mastra transcripts.

## Target Data Shape

- login_inspect returns inputs with opaque refs, type, autocomplete, accessible label, origin and form grouping plus a masked numbered screenshot. It returns no field values or assigned roles.
- secure_fill({fields, accountId?}) and secure_entry_request({fields}) share a credential selection (username/password refs) or code selection (ordered refs). The backend checks actual elements and derives the entry form from selected roles.
- Requests persist code field references rather than detected targets. Cached inspections retain input metadata. Schema conversion preserves historical previews and their original metadata.
- Prototype data and submissions are synthetic; the app surface never collects real credentials or connects to the vault.

## Milestones

### 1. Standardized Model Selection

Status: validated and deployed to dev.

- Replace semantic classifiers with bounded generic input extraction and masking.
- Bind selections to one caller/page/frame/document, reject stale/mixed/duplicate refs and invalid role/type combinations before filling.
- Adapt services, requests, API metadata, guidance, synthetic tests and browser smokes. Remove superseded detectors.
- Validate and commit the implementation; update dev while preserving execution data.

Exit criteria: explicit selections handle staged credentials and unlabelled single/split codes; destination protections, reuse and secret-free submission pass focused tests.

### 2. Inline UI Prototypes

Status: in progress.

- Build interactive expanded-card and compact-card variants using Pal's Mantine controls, theme and conversation styling.
- Cover credentials/code requests, preview disclosure and completed/error/cancelled states using fixed demonstration values.
- Open a Kodex generative UI pane with local iteration controls and explicit conversational feedback actions.

Exit criteria: responsive self-contained pane opens in this thread, uses existing PWA components, and lets the user compare and exercise both designs without real credentials.

## Tests

- Browser: generic metadata/masking, explicit selections, stage transitions, odd OTP labels/order, empty/mixed/duplicate selections, password/comment refusal, owner/frame/document/URL/type changes.
- Existing API integration: staged reuse, direct code submission, idempotent completion, expiration, cancellation and secret-free records/events.
- Frontend type/contract checks and the existing login component/reload-safety tests.
- Synthetic execution Chrome smoke; inspect Apple/Amazon candidates without real credential submission.
- Prototype smoke at desktop/mobile dimensions and local interaction/state transitions.

## Validation Commands

```bash
cd backend
npm run build
npm run lint
npm test -- test/login.spec.ts
npm run test:e2e -- test/login.e2e-spec.ts
npm run openapi:check
cd ../frontend
npm run api:generate
npm run check
npm run test:unit -- test-unit/login-panel.test.tsx test-unit/reload-safety.test.ts
npm run check:ui
npm run trim
```

## Overall Exit Criteria

- One model-facing selection contract covers credentials and OTP with no semantic classifier or legacy target aliases.
- Relevant checks pass; architecture, guidance and plan reflect behavior; implementation is committed and dev updated.
- Inline PWA prototypes are available in the requested app surface for iteration; production chat UI remains unchanged until a direction is chosen.

## Validation Results

- Six focused browser/provider tests pass: generic extraction and masking, explicit roles, unlabelled/non-English fields, ordered alphanumeric code inputs, malformed/duplicate/mixed selections, wrong owner/frame/document/URL, readonly/clipped/repurposed fields and expiration. Provider HTTP/process fixtures remain green.
- Eleven API/client-contract cases pass. The private save/fill/code flow retains staged-login reuse, safe metadata, completion retries, expiry and supported client headers.
- Four frontend login/reload/compatibility tests pass, with strict types, generated API check, UI ownership and unused-code checks.
- Backend build/lint/boundaries/OpenAPI checks pass. Drizzle reports no schema drift. The first-party contract is version 4; PWA types and the iOS client header are aligned.
- Public Apple/Amazon inspection returns native username-stage input metadata without site-specific classifiers. The development execution-Chrome smoke fills selected credentials and six unclassified digit inputs without returning values or changing unrelated tabs/fields.
- Development migration/rebuild and PWA update completed. All 12 existing previews and 569,932 image bytes remain, with original metadata preserved. Pending legacy code bindings are cancelled because backend restart invalidates their DOM references.
