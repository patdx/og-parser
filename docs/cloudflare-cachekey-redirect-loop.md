# Cloudflare Bug Report Notes: Redirect Loop With Explicit `cf.cacheKey`

## Summary

We observed a redirect loop for `https://facebook.com` when fetching from a Cloudflare Worker using an explicit `cf.cacheKey`.

The same target succeeds with plain `fetch()` and succeeds in local dev, but fails in remote Cloudflare execution with a `Too many redirects` error.

The strongest signal from our tests is that the presence of explicit `cf.cacheKey` is the trigger.

Because of that, the current worker no longer sends an explicit custom cache key on its normal fetch path.

## Scope

- Product area: Cloudflare Workers subrequest fetch behavior
- Suspected component: cache-enabled subrequest path when an explicit `cf.cacheKey` is supplied
- Affected target used in reproduction: `https://facebook.com`

## Reproduction Summary

### Worker behavior under test

The worker issues an outbound request using:

```ts
await fetch(request, {
	cf: {
		cacheKey,
		cacheEverything: true,
		cacheTtl,
	},
})
```

The request is a normal GET request and relies on standard redirect-follow behavior.

### What we observed

Remote Cloudflare preview produced an error like:

```text
Too many redirects. https://facebook.com/, https://www.facebook.com/, https://www.facebook.com/, ...
```

The loop did not occur when:

- using plain `fetch(request)` with no CF cache options
- running locally in `wrangler dev`
- removing the explicit `cf.cacheKey` in remote preview

## Environment Matrix

### Plain Node.js fetch

- Result: success
- Observed behavior: follows the normal apex-to-www redirect and returns 200

### Local `wrangler dev`

- Result: success
- Observed behavior: no redirect loop reproduced

### Remote `wrangler dev --remote`

- Result with explicit `cf.cacheKey`: failure with `Too many redirects`
- Result without explicit `cf.cacheKey`: success

## Findings From Option Matrix

We ran controlled remote-preview tests against `facebook.com`.

Observed outcomes:

- explicit `cf.cacheKey` plus `cacheEverything: true` reproduced the loop
- a different explicit cache-key shape also reproduced the loop
- no explicit `cf.cacheKey` did not reproduce the loop

Interpretation:

- the problem is not tied to the exact key string we used
- the problem appears to be triggered by supplying any explicit cache key
- `cacheEverything` by itself was not enough to reproduce the issue in our testing

## Relevant workerd Source Findings

We inspected `src/workerd/api/http.c++` from workerd.

What it confirms:

- redirects are followed generically in the fetch implementation
- followed redirects are accumulated in a URL list
- a `Too many redirects` exception is thrown when the redirect count exceeds 20

What it does not confirm:

- any special redirect handling for `cf.cacheKey`
- any cache-key-specific branch that would directly explain the loop

Interpretation:

- workerd appears to be the layer that throws the visible exception
- the behavior triggered by explicit `cf.cacheKey` likely originates below the generic open-source redirect handler, in the downstream Cloudflare fetch or cache implementation

## Working Hypothesis

This is a hypothesis, not a confirmed internal implementation detail.

Possible explanation:

1. The first response from `https://facebook.com/` is a redirect.
2. That redirect response is associated with the explicit custom cache key.
3. When the runtime follows the redirect to `https://www.facebook.com/`, the next subrequest still uses the same explicit cache key.
4. The cache layer returns the prior redirect response again, rather than the real upstream response for the new URL.
5. Redirect follow repeats until workerd hits its 20-hop limit and throws `Too many redirects`.

This hypothesis is consistent with the fact that the failure is coupled to explicit `cf.cacheKey` rather than to the target URL alone.

## Why This Matters

This behavior makes an otherwise ordinary redirecting target fail only when Cloudflare cache-keyed subrequests are used.

From an application point of view, that is surprising because:

- standard fetch semantics should follow the redirect normally
- the same target works without explicit cache keying
- the same target works in non-remote environments

## Impact On Our Worker

Our worker parses Open Graph metadata from arbitrary pages.

This bug forced us to add an application-level fallback:

- try CF cache-enabled fetch first
- if the request fails with `Too many redirects`, retry with plain `fetch()`
- return the result with a diagnostic status of `BYPASS`

That workaround keeps the service working, but the underlying platform behavior still appears incorrect.

## Suggested Bug Report Framing

Suggested title:

`fetch()` with explicit `cf.cacheKey` can enter a redirect loop for normally redirecting targets such as `facebook.com`

Suggested core claim:

An explicit `cf.cacheKey` appears to alter redirect-follow behavior in remote Workers execution, causing repeated replay of redirect responses until the runtime throws `Too many redirects`, even though the same target succeeds with plain `fetch()`.

Suggested supporting points:

- reproducible in remote preview
- not reproducible in local dev
- not reproducible with plain fetch
- workerd source explains the exception shape but not the cache-key-specific trigger

## Minimal Repro Shape

```ts
export default {
	async fetch() {
		const request = new Request('https://facebook.com')

		return fetch(request, {
			cf: {
				cacheKey: 'https://example-worker.invalid/custom-key',
				cacheEverything: true,
				cacheTtl: 60,
			},
		})
	},
}
```

Expected behavior:

- follow the redirect chain and return the final upstream response

Observed behavior in remote execution:

- request can fail with `Too many redirects`

## Current Workaround

Do not rely solely on the cache-enabled fetch path for redirect-prone targets.

Current workaround in our worker:

1. Attempt cache-enabled fetch without an explicit custom `cf.cacheKey`.
2. If the error message matches `too many redirects`, retry with plain `fetch()`.
3. Preserve the resolved URL explicitly because cloned fallback responses may not retain `response.url`.

## Confidence Levels

- High confidence: explicit `cf.cacheKey` is the operational trigger in our repros.
- High confidence: the visible `Too many redirects` exception is thrown by workerd's generic redirect-follow path.
- Medium confidence: the root cause is an interaction between redirect following and Cloudflare's cache-keyed subrequest/cache layer.
- Medium confidence: the cached-first-redirect replay model is the correct explanation.

## Requested Platform Clarification

Questions worth asking Cloudflare:

- Is redirect following expected to reuse the same explicit `cf.cacheKey` across hops?
- Can a cached redirect response be replayed for a later hop when the URL changes but the explicit cache key does not?
- Is this a known limitation or bug in cache-enabled subrequests with custom keys?

## Repository Design Decision

Because of this behavior, our worker currently prefers:

- Cloudflare fetch caching on the common path
- no explicit custom `cf.cacheKey` on that path
- a one-time plain-fetch fallback on redirect-loop failure
- explicit preservation of final resolved URL metadata

This keeps the service available while preserving enough detail for a future platform bug report.
