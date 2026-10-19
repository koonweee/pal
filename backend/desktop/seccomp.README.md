# Chromium Namespace Support

`seccomp.json` derives from [Moby seccomp v0.2.3](https://github.com/moby/profiles/blob/seccomp/v0.2.3/seccomp/default.json), licensed under Apache 2.0. The only added rule allows `clone`, `setns`, and `unshare`, following [Playwright’s Docker guidance](https://playwright.dev/docs/docker#crawling-and-scraping).

The rule permits Chromium to create its internal namespaces. Compose retains the profile’s other syscall restrictions, the existing capabilities, and the container boundary. Chromium runs with its own namespace and Seccomp-BPF sandboxes enabled.

When updating the baseline, copy the upstream profile and retain the first namespace rule. Verify Chromium’s `chrome://sandbox` status and run the desktop smoke checks.
