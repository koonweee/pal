---
name: website-authentication
description: Sign in to websites, switch accounts, enter verification codes, recover rejected credentials, and honor website session-persistence preferences using Pal's secure-entry tools.
---

# Website authentication

## Inspect and choose fields

Continue an existing signed-in session unless the user asks for another account. Use `login_inspect` for input refs, HTML metadata and a masked numbered preview. You choose username/password or verification-code roles from page evidence. Passwords require password inputs. Code fields are an ordered ref array; use one ref for a single input. Inspect new pages before assigning new roles. While fields are populated, use masked inspection instead of ordinary DOM snapshots or screenshots.

Open a login tab with `login_inspect({action:["tab","new",url]})`. For known Next/Sign in/Trust controls, use inspection's action to act and observe in one call. Identify the next control before requesting private entry when possible. If already-inspected fields and the next control are known, call `secure_fill` directly with action to fill, act and inspect together. These media-returning tools stay outside code mode. Without action, filling does not click submit. A loading page or action/inspection failure needs inspection without repeating the action.

## Accounts and private entry

Use `secure_fill` without accountId by default; the host reuses the current flow, last successful matching account or sole match. Ambiguity opens the inline account picker. Supply accountId only for an explicit user choice of a matching saved account. For an explicit switch without a specific saved account, request entry with chooseAccount true. The picker offers saved accounts and Use a new account. For new or corrected details, request entry without chooseAccount even if accounts exist.

The inline form appears in Main and Task chat. It collects the complete username/password once, even on username-only pages. A later password page reuses that saved account through `secure_fill`. For verification codes, request code-only entry using the inspected refs; codes are transient. Never ask the user to choose account labels or enter secrets in chat.

Private credential submission, account selection and code entry fill bound fields directly. Yield on awaiting_user: the host already marks the owning Task needs-input. Workers report to their parent. On a filled notification, continue with the known next action and inspection; if the page advanced automatically, inspect without action. Do not refill or inspect solely to confirm filling. Saved/selected fallback notifications mean filling could not finish: inspect fresh fields and use `secure_fill`.

## Website session preferences

Honor Keep me signed in from fill results and entry notifications. Supply keepMeSignedIn only for explicit user text; otherwise the stored website preference applies. Find applicable Remember me/Keep me signed in or later persistence controls and choose or decline them using page evidence. Only claim application when you selected a relevant control; do not guarantee session retention. Declining persistence does not disable account reuse, delete credentials or request sign-out at task end.

On an already authenticated page, honor an explicit persistence instruction where possible and record intent with `login_session({action:"preference",keepMeSignedIn:...})`.

## Results and recovery

Verify website acceptance, including verification challenges, before `login_session({action:"complete"})`. Saving/filling alone is not login success. Explicit credential rejection calls for fresh inspection and corrected private entry immediately; yield instead of resubmitting rejected credentials. A password stage, verification challenge, CAPTCHA or network error alone is not rejection.

Fix invalid_input arguments directly. Reinspect stale fields or navigation changes. For an automatic recovery notification, inspect and replace the entry selection; stop when recovery reports failure and let the user retry through the card. Handle input_required before continuing.
