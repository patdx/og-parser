import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
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
						{"@context":"https://schema.org","@type":"WebSite","name":"Find Coffee"}
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
			requestUrl: 'https://www.findcoffee.app/en',
		})

		expect(result.htmlLang).toBe('en')
		expect(result.ldJsons).toEqual([
			{
				'@context': 'https://schema.org',
				'@type': 'WebSite',
				name: 'Find Coffee',
			},
		])
	})
})

describe('worker', () => {
	it('returns parsed Open Graph data for the requested URL', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				`<!doctype html>
				<html>
					<head>
						<meta property="og:title" content="Find Coffee" />
						<script type="application/ld+json">{"@type":"WebSite","name":"Find Coffee"}</script>
					</head>
				</html>`,
				{
					headers: {
						'content-type': 'text/html',
					},
				},
			),
		)

		const request = new IncomingRequest('https://worker.test/https://www.findcoffee.app/en')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect((await response.json()) as ParsedResponse).toMatchObject({
			title: 'Find Coffee',
			ldJsons: [{ '@type': 'WebSite', name: 'Find Coffee' }],
		})
	})

	it('avoids the redirect-prone CF cache fetch path for redirecting targets', async () => {
		const redirectLoopError = new Error(
			'Too many redirects. https://facebook.com/, https://www.facebook.com/',
		)
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
			async (_input: RequestInfo | URL, init?: RequestInit<RequestInitCfProperties>) => {
				if (init?.cf && typeof init.cf === 'object' && 'cacheKey' in init.cf) {
					throw redirectLoopError
				}

				return new Response('<meta property="og:title" content="Facebook" />', {
					headers: {
						'content-type': 'text/html',
					},
				})
			},
		)

		const request = new IncomingRequest('https://worker.test/facebook.com')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined()
		expect((await response.json()) as { title?: string }).toMatchObject({ title: 'Facebook' })
	})
})
