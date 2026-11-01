---
name: website-authentication
description: Sign in to websites and supported native Android apps, switch accounts, enter verification codes and payment cards, recover rejected credentials, and honor website session-persistence preferences using Pal's secure-entry tools.
---

# Secure authentication

## Inspect and choose fields

Continue an existing signed-in session unless the user asks for another account. Use `login_inspect` for input refs, field metadata and a preview (masked for browser, unmasked for Android). You choose username/password or verification-code roles from page evidence. Treat email, phone number, account number and other reusable identifiers as `username`. Treat a reusable password, account PIN or passcode as `password`; password roles require password inputs. Treat a one-time verification code as `code`. Code fields are an ordered ref array; use one ref for a single input. Pass only the opaque `i…` refs returned by the latest inspection—never labels, selectors or credential values. Inspect new pages before assigning new roles. For browser fields, use masked inspection while populated instead of ordinary DOM snapshots or screenshots.

Open a login tab with `login_inspect({action:["tab","new",url]})`. For known Next/Sign in/Trust controls, use inspection's action to act and observe in one call. Identify the next control before requesting private entry when possible. If already-inspected fields and the next control are known, call `secure_fill` directly with action to fill, act and inspect together. These media-returning tools stay outside code mode. Without action, filling does not click submit. A loading page or action/inspection failure needs inspection without repeating the action.

For Android, call `login_inspect({target:"android",website:"https://service.example"})` after navigating to the native login screen. Choose the account website from the app/service and user task for shared vault matching; installed apps require no registration. Use the same field roles, account choice and private-entry tools below. Omit browser action and keepMeSignedIn arguments. Use labels, screen context and input metadata to assign roles, including passwords/PINs with missing or visible-password flags. Editable native and embedded WebView fields use the same private path. Fields absent from inspection, card entry, device unlock and biometrics need a manual phone handoff. Android screenshots and private-entry previews show the screen without masking, including any visible field values. Act with Android tools only after filling or private submission completes; navigation invalidates inspected refs. Structured Android inspection omits editable values. A partial/uncertain fill needs fresh observation and verification of current stage before choosing any further fill.

## Accounts and private entry

Use `secure_fill` without accountId by default; the host reuses the current flow, last successful matching account or sole match. Ambiguity opens the inline account picker. Supply accountId only for an explicit user choice of a matching saved account. For an explicit switch without a specific saved account, request entry with chooseAccount true. The picker offers saved accounts and Use a new account. For new or corrected details, request entry without chooseAccount even if accounts exist.

The inline form appears in Main and Task chat and collects only the credential roles you select. Request the current page's missing roles: a phone-only page requests `username`, and a later PIN-only page requests `password`. The host merges staged credential values into the active saved account. For verification codes, request code-only entry using the inspected refs; codes are transient and never merged into the account. Never ask the user to choose account labels or enter secrets in chat.

Private credential submission, account selection and code entry fill bound fields directly. Yield on awaiting_user: the host already marks the owning Task needs-input. Workers report to their parent. On a filled notification, continue with the known next action and inspection; if the page advanced automatically, inspect without action. Do not refill or inspect solely to confirm filling. Saved/selected fallback notifications mean filling could not be confirmed: inspect current state and any advancement, then fill fresh fields only when still needed.

## Website session preferences

Honor Keep me signed in from fill results and entry notifications. Supply keepMeSignedIn only for explicit user text; otherwise the stored website preference applies. Find applicable Remember me/Keep me signed in or later persistence controls and choose or decline them using page evidence. Only claim application when you selected a relevant control; do not guarantee session retention. Declining persistence does not disable account reuse, delete credentials or request sign-out at task end.

On an already authenticated page, honor an explicit persistence instruction where possible and record intent with `login_session({action:"preference",keepMeSignedIn:...})`.

## Results and recovery

Verify website/app acceptance, including verification challenges, before `login_session({action:"complete"})`. Saving/filling alone is not login success. Explicit credential rejection calls for fresh inspection and corrected private entry immediately; yield instead of resubmitting rejected credentials. A password stage, verification challenge, CAPTCHA or network error alone is not rejection.

Fix invalid_input arguments directly. Reinspect stale fields or navigation changes. If `secure_fill` returns `status: filled` with `actionStatus: failed`, the values are already in the fields: inspect without action and never refill or request entry solely because the action failed. For an automatic recovery notification, inspect and replace the entry selection; stop when recovery reports failure and let the user retry through the card. Handle input_required before continuing.

## Payment entry

Use the same secure-entry tools for payment fields. Assign cardholderName, number, expiry (combined MM/YY), expMonth, expYear and securityCode from inspected page evidence; never mix card and login/code roles. Hosted payment frames and month/year selects are supported. Use secure_fill with only fields to open the private Bitwarden card picker. For new details use secure_entry_request; for a website-saved card request only missing expiry/securityCode roles. Bitwarden cards and website-saved cards are separate sources.

The inline form owns card selection and optional vault saving. Payment values never belong in chat, ordinary browser tools, screenshots or handoffs. Card filling performs no browser action or purchase submission; continue with masked inspection and the user's purchase instructions. Do not save a card on the merchant website unless authorized. Recovery uses the same request ID handoff; transient values must be entered again after stale bindings. Only credentials use login_session.
