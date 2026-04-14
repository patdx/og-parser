# Copilot Instructions

## Commands

| Task | Command | Notes |
| --- | --- | --- |
| Start the Worker locally | `pnpm dev` | Alias: `pnpm start` |
| Deploy the Worker | `pnpm deploy` | Uses Wrangler |
| Run tests in watch mode | `pnpm test` | This starts Vitest watch mode |
| Run the full test suite once | `pnpm exec vitest run` | Prefer this in automated sessions |
| Run a single test | `pnpm exec vitest run test/index.spec.ts -t "returns parsed Open Graph data for the requested URL"` | Adjust the file path or `-t` filter as needed |
| Regenerate Worker types | `pnpm run cf-typegen` | Run after changing `wrangler.jsonc` bindings |
| Check formatting | `pnpm exec prettier --check .` | There is no dedicated lint script |

## High-level architecture

- This repository is a single Cloudflare Worker that accepts a target page URL in the request path (`GET /<url-encoded-target-url>`), fetches that page, extracts Open Graph metadata, and returns JSON.
- `src/index.ts` is the only entrypoint. It handles a small set of special paths (`/`, `robots.txt`, icon requests, `security.txt`, `sitemap.xml`), rejects non-`GET` requests, applies the `MY_RATE_LIMITER` binding, validates the target URL, and returns the parsed JSON payload.
- URL handling is split into `extractURLFromRequest()` and `validateAndNormalizeURL()` in `src/url-utils.ts`. Missing schemes are normalized to `https://`, and invalid inputs are surfaced as `URLValidationError`, which the Worker maps to a `400` JSON response.
- Remote fetches go through `cfCacher()` in `src/cf-cacher.ts`, not direct inline `fetch()` calls. The cache key is derived from the normalized target URL and includes the incoming `accept-language` header so language-specific pages stay distinct.
- `src/og-parser.ts` uses Cloudflare `HTMLRewriter` handlers instead of a DOM parser. It maps well-known `og:*` fields to top-level response properties, preserves additional `og:*` tags in `metadata`, captures `<html lang>`, and parses every `script[type="application/ld+json"]` block into `ldJsons`.
- The response shape is defined in `src/types.ts`. Debug mode is controlled in `src/index.ts` via the incoming request query string: `?debug` adds the fetched response body to `diagnostics.responseText`.
- Tests in `test/index.spec.ts` run in a Workers runtime through `@cloudflare/vitest-pool-workers`. Integration tests call `worker.fetch()` with `cloudflare:test` helpers and mock `globalThis.fetch` for the outbound page request.

## Key conventions

- Keep responsibilities separated: request/routing logic in `src/index.ts`, URL parsing in `src/url-utils.ts`, fetch/cache behavior in `src/cf-cacher.ts`, and HTML extraction in `src/og-parser.ts`.
- When changing fetch or cache logic, preserve the current `accept-language` forwarding in both the cache key and the outbound request headers.
- `src/index.ts` currently sets `useCfFetch: false` when calling `cfCacher()`. The existing worker test covers this path because Cloudflare cache-key fetches can be redirect-prone for some targets.
- When extending parser output, update `OpenGraphData` in `src/types.ts`, then the relevant `HTMLRewriter` handler in `src/og-parser.ts`, then the Worker/tests that assert the response shape.
- Treat `worker-configuration.d.ts` as generated output from Wrangler bindings. Do not hand-edit it; regenerate it with `pnpm run cf-typegen` after changing `wrangler.jsonc`.
- Formatting follows the existing Prettier setup: tabs for indentation, single quotes, no semicolons, and a 140-character print width.
