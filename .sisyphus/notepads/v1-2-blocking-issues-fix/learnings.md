## 2026-04-24T16:08:51.448Z Task: fail-closed correction update
- Removed the packaged acceptance of hard-coded `KONE-DEV-8888` in `LICENSE.SUBMIT` and `LICENSE.VERIFY`; the bypass now only works in non-packaged runs.
- Packaged `LICENSE.SUBMIT` no longer rewrites signed `expiresAt` to at least one year; it now respects the verified payload value.
- `scripts/security-audit.cjs` trial-to-premium scenario was updated back to a packaged-compatible failure-closure expectation because dev-only bypass is no longer valid in production review.
