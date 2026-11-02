# Shared Android Secure-Entry Helper

## Status

Done

## Goal

Let development and production use one Android phone without sharing or preserving an APK signing key, while retaining authenticated private filling and safe helper upgrades.

## Current Behavior

- Each Android sidecar rebuild creates its own debug signing identity.
- Every sidecar process tries to update `dev.pal.secureentry` before use, so switching between independently built development and production images can fail Android's signature check.
- The private bridge already authenticates each session with a fresh key and stores no account data.

## Milestones

### 1. Shared device helper lifecycle

Implementation tasks:

- Add an explicit bridge protocol version to the authenticated readiness response.
- Reuse an installed compatible helper before considering installation.
- Replace only the Pal-owned helper when it is missing, incompatible, or unusable, then verify the packaged helper protocol.
- Remove the signing-cache dependency from Android image builds.

Exit criteria:

- Development and production builds can alternate on one phone without matching APK signatures.
- A protocol change replaces the stateless helper and a compatible installed helper is left intact.

### 2. Environment rollout

Implementation tasks:

- Build and validate the local development Android image.
- Publish and pin the production Android image through Stack v2.
- Replace only the production Android sidecar and verify authenticated private inspection on the existing phone.

Exit criteria:

- Both environments carry the shared lifecycle behavior and production private inspection succeeds without exposing or submitting values.

## Tests

- Helper-client regression coverage for compatible reuse, initial install, incompatible replacement, and packaged-protocol verification.
- Existing helper transport test and Android/backend build checks.
- Production read-only private inspection after the targeted sidecar rollout.

## Validation Commands

```bash
cd backend
node --test android/helper-client.test.mjs
npm run build
npm run lint
cd ..
./scripts/dev-local config
docker compose -f backend/compose.yaml -f backend/compose.dev.yaml -f backend/compose.android.yaml build android-mcp
```

## Overall Exit Criteria

- APK signing remains an Android build detail rather than a cross-environment identity.
- The per-session bridge authentication and private-fill safety guarantees remain unchanged.
- Development and production use the same installed helper protocol on the shared phone.
- Source, deployment definitions, validation evidence, and plan status reflect the deployed state.

## Rollout Evidence

- Helper lifecycle tests, backend build/lint, Compose rendering, and the local Android image build pass.
- Production runs `pal-android:16914c1@sha256:a9152f50e452b956bb8bbb5fb3121160ba6c9b6bb9902039ffbe927dab66b316` through Stack v2 revision `98ed981`; only `android-mcp` was replaced.
- Production retained ADB authorization and completed authenticated read-only Chrome inspection with three editable inputs. Ordinary Mobile MCP recovered after the private helper handoff.
- The installed helper APK hash remained `f511f4f5056943755b601d3e03bad0a49aa2e0f3b94e5ec415e61698ac019bb6` before and after inspection, confirming cross-environment reuse without reinstalling the APK.
