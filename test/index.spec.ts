import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { RESOLVED_URL_HEADER } from '../src/cf-cacher'
import { parseOpenGraph } from '../src/og-parser'

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>
type ParsedResponse = {
	title?: string
	request_url: string
	resolve_url: string
	ld_jsons: Array<{
		'@type'?: string
		name?: string
	}>
	diagnostics?: {
		cf_cache_status?: string
		response_text?: string
	}
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
					<script type="application/ld+json">
						[
							{"@type":"CafeOrCoffeeShop","name":"North Harbor"},
							{"@type":"Bakery","name":"North Harbor Bakery"}
						]
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

		expect(result.html_lang).toBe('en')
		expect(result.ld_jsons).toEqual([
			{
				'@context': 'https://schema.org',
				'@type': 'WebSite',
				name: 'Orbital Atlas',
			},
			{
				'@type': 'CafeOrCoffeeShop',
				name: 'North Harbor',
			},
			{
				'@type': 'Bakery',
				name: 'North Harbor Bakery',
			},
		])
	})

	it('preserves all parsed meta tags in metadata and prefers og:image:secure_url over og:image', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<meta property="og:title" content="North Harbor Coffee" />
					<meta property="og:type" content="website" />
					<meta property="og:site_name" content="North Harbor" />
					<meta property="og:image" content="http://cdn.example/preview.jpg" />
					<meta property="og:image:secure_url" content="https://cdn.example/preview.jpg" />
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
			requestUrl: 'https://atlas.example/explore',
		})

		expect(result.image).toBe('https://cdn.example/preview.jpg')
		expect(result.metadata).toMatchObject({
			'og:title': 'North Harbor Coffee',
			'og:type': 'website',
			'og:site_name': 'North Harbor',
			'og:image': 'http://cdn.example/preview.jpg',
			'og:image:secure_url': 'https://cdn.example/preview.jpg',
		})
	})

	it('falls back to standard and twitter metadata when open graph tags are missing', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<meta name="description" content="Freshly roasted coffee and pastries." />
					<meta name="twitter:title" content="North Harbor Coffee" />
					<meta name="twitter:description" content="Small-batch coffee and seasonal desserts." />
					<meta name="twitter:image" content="https://cdn.example/card.jpg" />
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
			requestUrl: 'https://atlas.example/explore',
		})

		expect(result.title).toBe('North Harbor Coffee')
		expect(result.description).toBe('Freshly roasted coffee and pastries.')
		expect(result.image).toBe('https://cdn.example/card.jpg')
		expect(result.metadata).toMatchObject({
			description: 'Freshly roasted coffee and pastries.',
			'twitter:title': 'North Harbor Coffee',
			'twitter:description': 'Small-batch coffee and seasonal desserts.',
			'twitter:image': 'https://cdn.example/card.jpg',
		})
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

		expect(result.resolve_url).toBe('https://orbital-atlas.example/final')
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
			request_url: 'https://orbital-atlas.example/explore',
			resolve_url: 'https://orbital-atlas.example/explore',
			ld_jsons: [{ '@type': 'WebSite', name: 'Orbital Atlas' }],
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
		expect((await response.json()) as ParsedResponse).toMatchObject({
			title: 'Facebook',
			resolve_url: 'https://www.facebook.com/',
			diagnostics: {
				cf_cache_status: 'BYPASS',
			},
		})
	})

	it('uses snake_case diagnostics fields in debug responses', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('<html><head><meta property="og:title" content="Orbital Atlas" /></head></html>', {
				headers: {
					'content-type': 'text/html',
				},
			}),
		)

		const request = new IncomingRequest('https://worker.test/https://orbital-atlas.example/explore?debug')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect((await response.json()) as ParsedResponse).toMatchObject({
			diagnostics: {
				response_text: '<html><head><meta property="og:title" content="Orbital Atlas" /></head></html>',
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
