import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { RESOLVED_URL_HEADER } from '../src/cf-cacher'
import { parseOpenGraph } from '../src/og-parser'

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>
type ParsedResponse = {
	title?: string
	ldJsons: Array<{
		'@type'?: string
		name?: string
	}>
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('parseOpenGraph', () => {
	it('extracts JSON-LD from application/ld+json scripts', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						{"@context":"https://schema.org","@type":"WebSite","name":"Orbital Atlas"}
					</script>
				</head>
			</html>`,
			{
				headers: {
					'content-type': 'text/html',
				},
			},
		)

		const result = await parseOpenGraph({
			response,
			requestUrl: 'https://orbital-atlas.example/explore',
		})

		expect(result.htmlLang).toBe('en')
		expect(result.ldJsons).toEqual([
			{
				'@context': 'https://schema.org',
				'@type': 'WebSite',
				name: 'Orbital Atlas',
			},
		])
	})

	it('falls back to the preserved resolved URL header when a cloned response has no url', async () => {
		const response = new Response('<html></html>', {
			headers: {
				[RESOLVED_URL_HEADER]: 'https://orbital-atlas.example/final',
				'content-type': 'text/html',
			},
		})

		const result = await parseOpenGraph({
			response,
			requestUrl: 'https://orbital-atlas.example/explore',
		})

		expect(result.resolvedUrl).toBe('https://orbital-atlas.example/final')
	})
})

describe('worker', () => {
	it('returns parsed Open Graph data for the requested URL', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				`<!doctype html>
				<html>
					<head>
						<meta property="og:title" content="Orbital Atlas" />
						<script type="application/ld+json">{"@type":"WebSite","name":"Orbital Atlas"}</script>
					</head>
				</html>`,
				{
					headers: {
						'content-type': 'text/html',
					},
				},
			),
		)

		const request = new IncomingRequest('https://worker.test/https://orbital-atlas.example/explore')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			cf: {
				cacheEverything: true,
				cacheTtl: 60,
			},
		})
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit<RequestInitCfProperties>)?.cf).not.toHaveProperty('cacheKey')
		expect((await response.json()) as ParsedResponse).toMatchObject({
			title: 'Orbital Atlas',
			ldJsons: [{ '@type': 'WebSite', name: 'Orbital Atlas' }],
		})
	})

	it('falls back from the redirect-prone CF cache path for redirecting targets', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
				if (init?.cf && typeof init.cf === 'object' && 'cacheEverything' in init.cf) {
					throw new Error('Too many redirects. https://facebook.com/, https://www.facebook.com/')
				}

				return withResponseUrl(
					new Response('<meta property="og:title" content="Facebook" />', {
						headers: {
							'content-type': 'text/html',
						},
					}),
					'https://www.facebook.com/',
				)
			})

		const request = new IncomingRequest('https://worker.test/facebook.com')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			cf: {
				cacheEverything: true,
				cacheTtl: 60,
			},
		})
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit<RequestInitCfProperties>)?.cf).not.toHaveProperty('cacheKey')
		expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined()
		expect((await response.json()) as { title?: string; resolvedUrl?: string; diagnostics?: { cfCacheStatus?: string } }).toMatchObject({
			title: 'Facebook',
			resolvedUrl: 'https://www.facebook.com/',
			diagnostics: {
				cfCacheStatus: 'BYPASS',
			},
		})
	})
})

function withResponseUrl(response: Response, url: string): Response {
	Object.defineProperty(response, 'url', {
		value: url,
		configurable: true,
	})

	return response
}
