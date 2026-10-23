# Synthetic login timing

Run from the repository root with the default local dev stack, Chrome, backend dependencies and Bitwarden configured:

```sh
python3 backend/scripts/login-latency/profile.py
```

The harness attaches temporarily to the existing agent service. Temporary fetch/execute taps expose the raw provider argument-completion and dispatch boundaries without enabling argument/result logging or restarting the application. It submits natural requests through the staged PWA, enters dummy credentials through its private forms and serves unique synthetic HTTPS hosts through Chrome routing. Cases cover a username/password/OTP/trust flow, wrong-password correction and an ambiguous account picker. Existing conversations and the execution desktop remain in use.

Output is in `.local/login-latency-detailed/`; previous runs are archived beside it. Open `detailed.html` for phase bars, `detailed-summary.json` for numeric attribution or `detailed-chrome-trace.json` in Chrome/Perfetto. Reanalyze an archived run with `python3 backend/scripts/login-latency/analyze.py <directory>`. Numeric output includes argument character counts and combined-inspection flags; readiness gaps use the actual browser field-scan start.

Markers cover model request/headers, first/complete tool arguments, response completion, actual tool execution, step discovery, next request and synthetic DOM readiness. Raw tool arguments, results, model text, cookies, passwords and codes are excluded from capture. Task-status calls record only the allowlisted status enum, allowing administrative turns to be classified. The fixture script contains clearly synthetic credential constants used only for these unique hosts. Call IDs come from execute context when available; analysis otherwise requires exactly one pending call with the same tool/thread and reports uncorrelated executions.

Cleanup restores methods/fetch, closes the diagnostic endpoint, removes injector files and deletes only exact-host fixture entries/tabs. Active synthetic cards are cancelled by the PWA driver before teardown. Interruptions that kill the orchestrator itself may require manual cleanup; do not run concurrent profiling sessions. Production code and model-facing contracts are unchanged.

For this run's exact registered fixture hosts, the temporary BrowserService tap creates an owned blank tab and navigates after the page attaches. External CDP tab creation can otherwise navigate before Playwright's synthetic HTTPS routing is installed, reaching Chrome's network-error page. This fixture-only adaptation uses the normal ownership path, emits fixture.opening_ready, adds its preparation time to tool duration and is restored at teardown. It never changes real-site navigation or production browser code.
