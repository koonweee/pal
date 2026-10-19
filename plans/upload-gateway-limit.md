# Production Upload Gateway Limit

## Status

Done

## Goal

Allow production clients to upload every file accepted by Pal's 25,000,000-byte backend limit.

## Current Behavior

- The backend accepts files up to 25,000,000 bytes.
- The production Nginx configuration accepts request bodies up to 25 MiB, leaving room for multipart framing around the backend's file limit.
- Native iOS reports HTTP 400 and 413 as a rejected message and restores the draft and selected images.

## Milestones

### 1. Align the Production Gateway

Implementation tasks:

- [x] Set the Nginx request-body limit to 25 MiB, leaving enough room for multipart framing around a 25,000,000-byte file.
- [x] Document the production gateway boundary.
- [x] Build and exercise the production web image, then publish and deploy the reviewed release.

Exit criteria:

- Nginx accepts a multipart request containing a 25,000,000-byte file and proxies it to the backend.
- The backend remains the authority that rejects a file over 25,000,000 bytes.
- Frontend build and relevant gateway validation pass.

## Tests

- Build the production playground image and validate its Nginx configuration.
- Through the disposable production gateway, upload files at and above the backend boundary and verify the backend returns success at the limit and HTTP 413 above it.

## Validation Commands

```bash
cd frontend-playground
npm run build
docker build -t pal-web:upload-limit-test .
```

## Overall Exit Criteria

- The built production gateway no longer imposes a lower upload limit than the backend.
- Validation passes and the reviewed image is deployed to `pal-sf`.

## Validation

- Frontend production build and all 21 Playwright tests pass.
- The production web image builds and its Nginx configuration passes `nginx -t`.
- A disposable gateway accepts a multipart request with a 25,000,000-byte file. A 25,000,001-byte file reaches the boundary-enforcing backend and receives HTTP 413 there.
- Pal source `46719b7` was published and deployed through Stack revision `92c92e4`.
- Production health, history continuity, and SSE idle-state checks pass.
- A malformed 2 MiB production request reaches the backend and receives HTTP 400, confirming the gateway accepts requests above the former 1 MiB ceiling.
