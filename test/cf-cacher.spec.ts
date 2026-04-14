import { afterEach, describe, expect, it, vi } from 'vitest'
import { cfCacher, RESOLVED_URL_HEADER } from '../src/cf-cacher'

describe('cfCacher', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('passes Cloudflare cache settings to fetch without an explicit cache key', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('cf-hit', {
				headers: {
					'cf-cache-status': 'HIT',
				},
			}),
		)

		const response = await cfCacher({
			getRequest: async () => new Request('https://origin.example/apex'),
			cacheTtl: 60,
		})

		expect(response.headers.get('cf-cache-status')).toBe('HIT')
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			cf: {
				cacheEverything: true,
				cacheTtl: 60,
			},
		})
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit<RequestInitCfProperties>)?.cf).not.toHaveProperty('cacheKey')
	})

	it('falls back to a plain fetch when the Cloudflare cache path hits a redirect loop', async () => {
		const getRequest = vi.fn(async () => new Request('https://apex.example'))
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
				if (init?.cf && typeof init.cf === 'object' && 'cacheEverything' in init.cf) {
					throw new Error('Too many redirects. https://apex.example/, https://www.example/')
				}

				return withResponseUrl(
					new Response('<meta property="og:title" content="Example" />', {
						headers: {
							'content-type': 'text/html',
						},
					}),
					'https://www.example/home',
				)
			})

		const response = await cfCacher({
			getRequest,
		})

		expect(getRequest).toHaveBeenCalledTimes(2)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			cf: {
				cacheEverything: true,
			},
		})
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit<RequestInitCfProperties>)?.cf).not.toHaveProperty('cacheKey')
		expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined()
		expect(response.headers.get('cf-cache-status')).toBe('BYPASS')
		expect(response.headers.get(RESOLVED_URL_HEADER)).toBe('https://www.example/home')
	})

	it('rethrows non-redirect failures from the Cloudflare cache path', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection reset by peer'))

		await expect(
			cfCacher({
				getRequest: async () => new Request('https://origin.example/error'),
			}),
		).rejects.toThrow('connection reset by peer')
	})

	it('uses the original request URL when the fallback response does not expose a resolved URL', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
			if (init?.cf && typeof init.cf === 'object' && 'cacheEverything' in init.cf) {
				throw new Error('Too many redirects. https://landing.example/, https://www.landing.example/')
			}

			return new Response('<html></html>', {
				headers: {
					'content-type': 'text/html',
				},
			})
		})

		const response = await cfCacher({
			getRequest: async () => new Request('https://landing.example/welcome'),
		})

		expect(response.headers.get(RESOLVED_URL_HEADER)).toBe('https://landing.example/welcome')
	})
})

function withResponseUrl(response: Response, url: string): Response {
	Object.defineProperty(response, 'url', {
		value: url,
		configurable: true,
	})

	return response
}
