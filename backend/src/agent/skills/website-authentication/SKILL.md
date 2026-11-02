---
name: website-authentication
description: Sign in to websites and supported native Android apps, switch accounts, enter verification codes and payment cards, recover rejected credentials, and honor website session-persistence preferences using Pal's secure-entry tools.
---

# Secure authentication

## Inspect and choose fields

Continue an existing signed-in session unless the user asks for another account. Navigate with ordinary computer or Android tools, then call `inspect_private_fields` on that active surface for private input refs, field metadata and a preview. Ordinary inspection does not inspect private fields or test whether private entry works. Treat each private inspection call as a fresh attempt; do not reuse an earlier failure after navigation or a deployment.

Choose username/password or verification-code roles from page evidence. Treat email, phone number, account number and other reusable identifiers as `username`. Treat a reusable password, account PIN or passcode as `password`; password roles require password inputs. Treat a one-time verification code as `code`. Code fields are an ordered ref array; use one ref for a single input. Pass only opaque refs from the latest private inspection to `enter_private_fields`, never labels, selectors or values. Filling does not click submit; use ordinary interaction tools for Next, Sign in and other controls. A loading or changed page needs fresh private inspection.

For Android, supply `accountOrigin` to private inspection using the service's HTTPS account origin for shared vault matching. Installed apps require no registration. Omit keepMeSignedIn. Use labels, screen context and input metadata to assign roles, including passwords or PINs with missing flags. Editable native and embedded WebView fields use the same private path. Fields absent from private inspection, payment entry, device unlock and biometrics need a manual phone handoff. Android private previews are unmasked; structured inspection omits editable values. Act with Android tools only after filling or private submission completes.

## Accounts and private entry

Call `enter_private_fields` once for the selected refs. The host reuses the current flow, last successful matching account or sole match; opens a picker for ambiguity; and opens private entry when required values are unavailable. Set chooseAccount true only when the user explicitly asks to choose or switch accounts. The picker includes Use a new account.

The inline form appears in Main and Task chat and collects only the credential roles you select. Request the current page's missing roles: a phone-only page requests `username`, and a later PIN-only page requests `password`. The host merges staged credential values into the active saved account. For verification codes, request code-only entry using the inspected refs; codes are transient and never merged into the account. Never ask the user to choose account labels or enter secrets in chat.

Private credential submission, account selection and code entry fill bound fields directly. Yield on awaiting_user: the host already marks the owning Task needs-input. Workers report to their parent. On a filled notification, continue with the known next action and inspection; if the page advanced automatically, inspect the current page. Do not refill or inspect solely to confirm filling. Saved/selected fallback notifications mean filling could not be confirmed: inspect current state and any advancement, then fill fresh fields only when still needed.

## Website session preferences

Honor Keep me signed in from fill results and entry notifications. Supply keepMeSignedIn only for explicit user text; otherwise the stored website preference applies. Find applicable Remember me/Keep me signed in or later persistence controls and choose or decline them using page evidence. Only claim application when you selected a relevant control; do not guarantee session retention. Declining persistence does not disable account reuse, delete credentials or request sign-out at task end.

On an already authenticated browser page, honor an explicit persistence instruction where possible and record it with `confirm_authentication({keepMeSignedIn:...})`.

## Results and recovery

Verify website or app acceptance, including verification challenges, before `confirm_authentication()`. Saving or filling alone is not login success. After explicit credential rejection, inspect private fields again and set chooseAccount true so the user can correct or replace the rejected account; yield instead of resubmitting it. A password stage, verification challenge, CAPTCHA or network error alone is not rejection.

Fix invalid_input arguments directly. Reinspect stale fields or navigation changes. For automatic recovery, inspect private fields and replace the entry selection; stop when recovery reports failure and let the user retry through the card.

## Payment entry

Use the same private tools for payment fields. Assign cardholderName, number, expiry (combined MM/YY), expMonth, expYear and securityCode from private inspection; never mix card and login/code roles. Hosted payment frames and month/year selects are supported. `enter_private_fields` opens private entry or the saved-card picker. For a website-saved card, select only missing expiry or security-code roles. Bitwarden cards and website-saved cards are separate sources.

The inline form owns card selection and optional vault saving. Payment values never belong in chat, ordinary browser tools, screenshots or handoffs. Card filling performs no browser action or purchase submission; continue with masked private inspection and the user's purchase instructions. Do not save a card on the merchant website unless authorized. Recovery uses the same request ID handoff; transient values must be entered again after stale bindings. Only credentials use authentication confirmation.
