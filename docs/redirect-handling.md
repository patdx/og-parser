# Redirect Handling Design

## Purpose

This document explains why the worker uses Cloudflare fetch caching without an explicit custom cache key, along with a redirect-loop fallback, instead of relying on the manual Cache API path or a custom `cf.cacheKey`.

It records the verified behavior we observed, the constraints we found in Cloudflare's platform behavior, and the reasoning behind the current design in `src/cf-cacher.ts`.

## Short Version

We use `fetch(request, { cf: { cacheEverything: true, cacheTtl } })` by default because it preserves normal fetch semantics, including automatic redirect following.

Some targets, notably `https://facebook.com`, can fail in Cloudflare's remote cache-enabled fetch path with `Too many redirects` when an explicit `cf.cacheKey` is supplied.

We reproduced that behavior and then removed the explicit custom cache key from the worker.

When that specific failure happens, we retry once with plain `fetch(request)` and mark the response with `cf-cache-status: BYPASS`.

This gives us:

- normal redirect handling on the common path
- a working fallback for redirect-prone targets
- correct `resolvedUrl` reporting after fallback
- better behavior than the manual Cache API path for responses that set cookies or send `Cache-Control: private` or `no-store`

## What We Verified

### 1. The manual Cache API path caused a real regression

When we switched the worker to `useCfFetch: false`, cloned responses lost `response.url`.

That made parser output lose the final resolved URL after redirects unless we preserved it ourselves.

The parser now reads the final URL from `x-og-parser-resolved-url` when `response.url` is empty.

### 2. The manual Cache API path is a poor fit for sites like Facebook

`facebook.com` redirects to `www.facebook.com`, and the final response includes headers that make manual edge caching ineffective, including cookie-setting behavior and cache directives that are not suitable for reuse.

In practice, that meant:

- the Cache API path kept returning `cfCacheStatus: MISS`
- the worker did not benefit from caching on repeated requests
- the manual path added complexity without solving the redirect problem

### 3. The redirect-loop is real in remote Cloudflare execution

We reproduced the issue with `wrangler dev --remote`.

We did not reproduce it with:

- plain Node.js `fetch()`
- local `wrangler dev`

This matters because it shows the issue is not a general web redirect problem and not a generic Fetch API problem. It is specific to the Cloudflare remote subrequest path.

### 4. `cacheEverything` alone did not trigger the loop

We ran a remote-preview matrix against `facebook.com`.

Observed results:

- default CF fetch config with explicit `cf.cacheKey` and `cacheEverything: true` reproduced the loop and hit fallback
- no explicit `cf.cacheKey`, while keeping `cacheEverything: true`, succeeded
- explicit `cf.cacheKey` with `cacheEverything` disabled still succeeded in some non-default modes, but the stable reproduction was tied to explicit cache-key usage
- using a different explicit key shape still reproduced the problem

The strongest result from the experiments was this:

- any explicit `cf.cacheKey` we tested could reproduce the Facebook loop
- removing `cf.cacheKey` stopped reproducing it

That means the trigger is the presence of an explicit cache key, not the particular `accept-language` query decoration we add to the key.

### 5. workerd explains the error shape, but not the root cause

We inspected workerd source at:

- `src/workerd/api/http.c++`

Relevant behavior from workerd:

- redirects are followed automatically when request redirect mode is `follow`
- redirect targets are accumulated in an internal `urlList`
- the runtime throws `TypeError: Too many redirects.` when the list exceeds `MAX_REDIRECT_COUNT`, which is 20

This explains why the error listed repeated URLs like `https://facebook.com/` and `https://www.facebook.com/`.

It does not explain why supplying `cf.cacheKey` makes that happen. The `http.c++` path serializes the `cf` object and passes it downstream, but the redirect logic itself is generic. That points to the problem living below this open-source redirect handler, in Cloudflare's cache-backed fetch path.

## Current Design

### Default behavior

`cfCacher()` now wraps only the Cloudflare fetch-caching path plus a targeted plain-fetch fallback.

Why:

- it stays closer to normal `fetch()` behavior
- it lets the platform follow redirects rather than making us cache redirect hops ourselves
- it avoids the Cache API limitations that made Facebook effectively uncacheable anyway
- it avoids the explicit `cf.cacheKey` setting that reproduced the Facebook redirect loop in remote Cloudflare execution

The helper intentionally does not support the old manual Cache API mode anymore.

That API surface was no longer buying us anything useful:

- the worker had already standardized on the CF fetch path
- the manual path carried extra options and tests for behavior we no longer wanted
- the explicit custom cache-key experiment gave us a simpler, safer configuration to converge on

### Redirect-loop fallback

If the cache-enabled fetch throws an error whose message matches `too many redirects`, we:

1. log the failure
2. retry with plain `fetch(request)`
3. return the plain-fetch response with `cf-cache-status: BYPASS`
4. preserve the resolved URL in `x-og-parser-resolved-url`

Why this is acceptable:

- the failure mode is target-specific and appears platform-specific
- the retry keeps the request working for users
- the fallback is narrow, rather than disabling Cloudflare caching globally

### Resolved URL preservation

Cloned `Response` objects can lose the final URL.

To avoid returning an empty `resolvedUrl`, the worker stores the resolved URL in `x-og-parser-resolved-url` and the parser uses that header as a fallback.

This is necessary for:

- fallback responses returned from the redirect-loop bypass path
- any path that reconstructs a `Response` object from another response

## Why We Did Not Keep the Manual Cache API As The Default

It looked attractive because it avoids the redirect-loop in Cloudflare's cache-enabled subrequest path. In practice, it created worse behavior:

- it did not preserve `response.url` unless we patched around it
- it stayed `MISS` for targets that set cookies or send non-cacheable directives
- it pushed redirect correctness and cache semantics into our application layer

The worker's job is to fetch a page and parse metadata, not to emulate an HTTP cache or reconstruct redirect chains manually.

The current design keeps the simple path simple and isolates the Cloudflare-specific failure behind a targeted retry.

## Working Hypothesis For The Cloudflare Bug

This hypothesis matches the observed behavior, but is not proven by the workerd source we inspected.

Possible mechanism:

1. The first request to `https://facebook.com/` is made with an explicit `cf.cacheKey`.
2. Cloudflare stores or reuses the redirect response under that explicit cache key.
3. The fetch machinery follows the redirect to `https://www.facebook.com/`.
4. Because the request still carries the same explicit `cf.cacheKey`, the cache lookup resolves to the earlier cached redirect response instead of the new location's real upstream response.
5. The runtime sees the same redirect outcome repeatedly and eventually throws `Too many redirects` after 20 hops.

This would explain all of the following:

- why the loop is not visible in plain `fetch()`
- why the loop is not visible in local dev
- why explicit `cf.cacheKey` is the main trigger
- why the repeated URL list alternates between the apex and `www` URL rather than traversing a more complex chain

We should treat this as a plausible explanation, not as a confirmed implementation detail.

## Operational Guidance

If a target starts failing with a redirect loop in the CF fetch path:

- keep the plain-fetch fallback in place
- preserve `x-og-parser-resolved-url` on the fallback response
- do not switch the entire worker back to manual Cache API caching just to avoid the loop

The worker now follows that lowest-risk configuration:

- keep `cacheEverything: true`
- do not send explicit `cf.cacheKey`
- keep the plain-fetch fallback for the redirect-loop failure mode

## Evidence Summary

- Remote Cloudflare preview reproduced `Too many redirects` for `facebook.com` when explicit `cf.cacheKey` was present.
- Local dev and plain Node fetch did not reproduce it.
- workerd source shows redirect-follow logic and the 20-hop redirect limit, which matches the error format.
- workerd source does not show `cf.cacheKey`-specific redirect behavior.
- Manual Cache API caching caused persistent misses for Facebook and previously broke `resolvedUrl` reporting.

## Current Recommendation

Keep the current design:

- default to Cloudflare fetch caching
- do not send explicit `cf.cacheKey` on the hot path
- fall back to plain fetch on redirect-loop errors
- preserve the resolved URL explicitly when cloning or bypassing responses

This is the smallest design that matches observed platform behavior while keeping the worker reliable for end users.
