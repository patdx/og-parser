import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { RESOLVED_URL_HEADER } from '../src/cf-cacher'
import { deriveOpenGraphData, extractOpenGraphData, parseOpenGraph } from '../src/og-parser'
import type { MetaTag } from '../src/types'

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>
type ParsedResponse = {
	title?: string
	request_url: string
	resolve_url: string
	canonical_url?: string
	image_alt?: string
	image_width?: number
	image_height?: number
	image_type?: string
	locale?: string
	authors?: string[]
	published_at?: string
	modified_at?: string
	meta_tags: MetaTag[]
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

	it('uses og:url for canonical_url and falls back to JSON-LD url when open graph canonical data is absent', async () => {
		const ogResponse = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<meta property="og:url" content="https://orbital-atlas.example/canonical" />
					<script type="application/ld+json">
						{"@context":"https://schema.org","@type":"WebPage","url":"https://orbital-atlas.example/from-json-ld"}
					</script>
				</head>
			</html>`,
			{
				headers: {
					'content-type': 'text/html',
				},
			},
		)

		const ogResult = await parseOpenGraph({
			response: ogResponse,
			requestUrl: 'https://orbital-atlas.example/requested',
		})

		expect(ogResult.canonical_url).toBe('https://orbital-atlas.example/canonical')

		const ldJsonOnlyResponse = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						{"@context":"https://schema.org","@type":"WebPage","mainEntityOfPage":"https://orbital-atlas.example/from-json-ld"}
					</script>
				</head>
			</html>`,
			{
				headers: {
					'content-type': 'text/html',
				},
			},
		)

		const ldJsonOnlyResult = await parseOpenGraph({
			response: ldJsonOnlyResponse,
			requestUrl: 'https://orbital-atlas.example/requested',
		})

		expect(ldJsonOnlyResult.canonical_url).toBe('https://orbital-atlas.example/from-json-ld')
	})

	it('uses page-level JSON-LD nodes for canonical_url and descends into @graph wrappers', async () => {
		const arrayResponse = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						[
							{"@context":"https://schema.org","@type":"Organization","url":"https://orbital-atlas.example"},
							{"@context":"https://schema.org","@type":"WebPage","url":"https://orbital-atlas.example/articles/launch"}
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

		const arrayResult = await parseOpenGraph({
			response: arrayResponse,
			requestUrl: 'https://orbital-atlas.example/requested',
		})

		expect(arrayResult.canonical_url).toBe('https://orbital-atlas.example/articles/launch')

		const graphResponse = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						{"@context":"https://schema.org","@graph":[{"@type":"Organization","url":"https://orbital-atlas.example"},{"@type":"WebPage","mainEntityOfPage":{"@id":"https://orbital-atlas.example/articles/graph"}}]}
					</script>
				</head>
			</html>`,
			{
				headers: {
					'content-type': 'text/html',
				},
			},
		)

		const graphResult = await parseOpenGraph({
			response: graphResponse,
			requestUrl: 'https://orbital-atlas.example/requested',
		})

		expect(graphResult.canonical_url).toBe('https://orbital-atlas.example/articles/graph')
	})

	it('promotes authors and publication timestamps from JSON-LD when available', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						{"@context":"https://schema.org","@type":"Article","datePublished":"2024-01-02T03:04:05Z","dateModified":"2024-01-03T04:05:06Z","author":[{"@type":"Person","name":"Ada Lovelace"},{"@type":"Person","name":"Grace Hopper"}]}
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
			requestUrl: 'https://orbital-atlas.example/articles/history',
		})

		expect(result.authors).toEqual(['Ada Lovelace', 'Grace Hopper'])
		expect(result.published_at).toBe('2024-01-02T03:04:05Z')
		expect(result.modified_at).toBe('2024-01-03T04:05:06Z')
	})

	it('preserves parsed meta tags in order and prefers og:image:secure_url over og:image', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<meta property="og:title" content="North Harbor Coffee" />
					<meta property="og:type" content="website" />
					<meta property="og:site_name" content="North Harbor" />
					<meta property="og:image" content="http://cdn.example/preview.jpg" />
					<meta property="og:image:secure_url" content="https://cdn.example/preview.jpg" />
					<meta property="og:image:alt" content="Preview image" />
					<meta property="og:image:width" content="1200" />
					<meta property="og:image:height" content="630" />
					<meta property="og:image:type" content="image/jpeg" />
					<meta property="og:locale" content="en_US" />
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
		expect(result.image_alt).toBe('Preview image')
		expect(result.image_width).toBe(1200)
		expect(result.image_height).toBe(630)
		expect(result.image_type).toBe('image/jpeg')
		expect(result.locale).toBe('en_US')
		expect(result.meta_tags).toEqual([
			{ key: 'og:title', content: 'North Harbor Coffee' },
			{ key: 'og:type', content: 'website' },
			{ key: 'og:site_name', content: 'North Harbor' },
			{ key: 'og:image', content: 'http://cdn.example/preview.jpg' },
			{ key: 'og:image:secure_url', content: 'https://cdn.example/preview.jpg' },
			{ key: 'og:image:alt', content: 'Preview image' },
			{ key: 'og:image:width', content: '1200' },
			{ key: 'og:image:height', content: '630' },
			{ key: 'og:image:type', content: 'image/jpeg' },
			{ key: 'og:locale', content: 'en_US' },
		])
	})

	it('keeps og:image fields tied to the selected image group', () => {
		const result = deriveOpenGraphData({
			request_url: 'https://atlas.example/explore',
			resolve_url: 'https://atlas.example/explore',
			canonical_url: undefined,
			title: undefined,
			description: undefined,
			image: undefined,
			image_alt: undefined,
			image_width: undefined,
			image_height: undefined,
			image_type: undefined,
			site_name: undefined,
			type: undefined,
			html_lang: 'en',
			locale: undefined,
			authors: undefined,
			published_at: undefined,
			modified_at: undefined,
			meta_tags: [
				{ key: 'og:image', content: 'http://cdn.example/first.jpg' },
				{ key: 'og:image:secure_url', content: 'https://cdn.example/first.jpg' },
				{ key: 'og:image:alt', content: 'First image' },
				{ key: 'og:image:width', content: '1200' },
				{ key: 'og:image:height', content: '630' },
				{ key: 'og:image:type', content: 'image/jpeg' },
				{ key: 'og:image', content: 'https://cdn.example/second.jpg' },
				{ key: 'og:image:alt', content: 'Second image' },
				{ key: 'og:image:width', content: '800' },
			],
			ld_jsons: [],
			diagnostics: {},
		})

		expect(result.image).toBe('https://cdn.example/first.jpg')
		expect(result.image_alt).toBe('First image')
		expect(result.image_width).toBe(1200)
		expect(result.image_height).toBe(630)
		expect(result.image_type).toBe('image/jpeg')
	})

	it('only promotes page-level structured-data summary fields', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<script type="application/ld+json">
						{
							"@context":"https://schema.org",
							"@type":"Article",
							"author":{"@type":"Person","name":"Ada Lovelace"},
							"review":{
								"@type":"Review",
								"author":{"@type":"Person","name":"Nested Reviewer"},
								"datePublished":"2024-01-05T06:07:08Z"
							},
							"comment":{
								"@type":"Comment",
								"author":{"@type":"Person","name":"Nested Commenter"},
								"dateModified":"2024-01-06T07:08:09Z"
							}
						}
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
			requestUrl: 'https://orbital-atlas.example/articles/history',
		})

		expect(result.authors).toEqual(['Ada Lovelace'])
		expect(result.published_at).toBeUndefined()
		expect(result.modified_at).toBeUndefined()
	})

	it('falls back to standard and twitter meta tags when open graph tags are missing', async () => {
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
		expect(result.meta_tags).toEqual([
			{ key: 'description', content: 'Freshly roasted coffee and pastries.' },
			{ key: 'twitter:title', content: 'North Harbor Coffee' },
			{ key: 'twitter:description', content: 'Small-batch coffee and seasonal desserts.' },
			{ key: 'twitter:image', content: 'https://cdn.example/card.jpg' },
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

		expect(result.resolve_url).toBe('https://orbital-atlas.example/final')
	})

	it('extracts raw ordered meta tags before deriving promoted fields', async () => {
		const response = new Response(
			`<!doctype html>
			<html lang="en">
				<head>
					<meta property="og:image" content="http://cdn.example/first.jpg" />
					<meta property="og:image:secure_url" content="https://cdn.example/first.jpg" />
					<meta property="og:image:alt" content="First image" />
					<meta property="og:image" content="https://cdn.example/second.jpg" />
					<meta name="twitter:image" content="https://cdn.example/card.jpg" />
				</head>
			</html>`,
			{
				headers: {
					'content-type': 'text/html',
				},
			},
		)

		const result = await extractOpenGraphData({
			response,
			requestUrl: 'https://atlas.example/explore',
		})

		expect(result.image).toBeUndefined()
		expect(result.meta_tags).toEqual([
			{ key: 'og:image', content: 'http://cdn.example/first.jpg' },
			{ key: 'og:image:secure_url', content: 'https://cdn.example/first.jpg' },
			{ key: 'og:image:alt', content: 'First image' },
			{ key: 'og:image', content: 'https://cdn.example/second.jpg' },
			{ key: 'twitter:image', content: 'https://cdn.example/card.jpg' },
		])
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
						<meta property="og:url" content="https://orbital-atlas.example/explore" />
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
			canonical_url: 'https://orbital-atlas.example/explore',
			meta_tags: [
				{ key: 'og:title', content: 'Orbital Atlas' },
				{ key: 'og:url', content: 'https://orbital-atlas.example/explore' },
			],
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
