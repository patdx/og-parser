import { validateAndNormalizeURL, extractURLFromRequest, URLValidationError } from './url-utils'
import { parseOpenGraph } from './og-parser'
import { cfCacher } from './cf-cacher'
import { seconds } from 'itty-time'

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Only allow GET requests
		if (request.method !== 'GET') {
			return new Response('Method not allowed', { status: 405 })
		}

		const url = new URL(request.url)

		// Handle common web requests
		switch (url.pathname) {
			case '/favicon.ico':
			case '/apple-touch-icon.png':
			case '/apple-touch-icon-precomposed.png':
			case '/android-chrome-192x192.png':
			case '/android-chrome-512x512.png':
				return new Response('Not Found', {
					status: 404,
					headers: {
						'Content-Type': 'text/plain',
					},
				})

			case '/robots.txt':
				return new Response('User-agent: *\nDisallow: /', {
					headers: {
						'Content-Type': 'text/plain',
						'Cache-Control': 'public, max-age=86400',
					},
				})

			case '/sitemap.xml':
				return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
					headers: {
						'Content-Type': 'application/xml',
						'Cache-Control': 'public, max-age=86400',
					},
				})

			case '/.well-known/security.txt':
			case '/security.txt':
				return new Response('Contact: mailto:security@example.com\nExpires: 2025-12-31T23:59:59.000Z', {
					headers: {
						'Content-Type': 'text/plain',
						'Cache-Control': 'public, max-age=86400',
					},
				})

			case '/':
				return new Response('Open Graph Parser API - Please provide a URL to parse', {
					status: 400,
					headers: {
						'Content-Type': 'text/plain',
					},
				})
		}

		const key = 'default'
		const { success } = await env.MY_RATE_LIMITER.limit({ key: key }) // key can be any string of your choosing

		if (!success) {
			return new Response(`429 Failure – rate limit exceeded for ${key}`, { status: 429 })
		}

		try {
			// Extract and validate the target URL
			const targetUrl = extractURLFromRequest(request)
			const validatedUrl = validateAndNormalizeURL(targetUrl)

			const cacheKey = new URL(validatedUrl.toString())
			copyHeader(request.headers, cacheKey.searchParams, 'accept-language')

			const response = await cfCacher({
				cacheKey: cacheKey.toString(),
				getFreshValue: async () => {
					const outgoingRequest = new Request(validatedUrl.toString(), {
						headers: {
							'User-Agent': 'OG-Parser Bot/1.0',
						},
					})

					copyHeader(request.headers, outgoingRequest.headers, 'accept-language')
					return outgoingRequest
				},
				executionCtx: ctx,
				cacheTtl: seconds('1 minute'),
				useCfFetch: true,
			})

			if (!response.ok) {
				let text: string
				try {
					text = await response.text()
				} catch (e) {
					text = 'Failed to read response text'
				}
				console.error(`Error fetching URL: ${response.status} - ${text}`)
				throw new Error(`Failed to fetch URL: ${response.status}`)
			}

			// Clone response for debug output
			const responseClone = response.clone()
			const debugMode = url.searchParams.has('debug')

			// Parse the Open Graph data
			const ogData = await parseOpenGraph({
				response,
				requestUrl: validatedUrl.toString(),
				cfColo: request.cf?.colo as string | undefined,
				cfCacheStatus: response.headers.get('cf-cache-status') ?? undefined,
			})

			if (debugMode) {
				const responseText = await responseClone.text()
				ogData.diagnostics.responseText = responseText
			}

			// Return JSON response with caching headers
			return new Response(JSON.stringify(ogData, null, 2), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600',
					'Access-Control-Allow-Origin': '*',
				},
			})
		} catch (error: unknown) {
			const errorResponse = {
				error: error instanceof URLValidationError ? 'Invalid URL' : 'Internal Server Error',
				message: error instanceof Error ? error.message : 'An unknown error occurred',
			}

			return new Response(JSON.stringify(errorResponse), {
				status: error instanceof URLValidationError ? 400 : 500,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
				},
			})
		}
	},
} satisfies ExportedHandler<Env>

function copyHeader(from: Headers, to: Headers | URLSearchParams, header: string): void {
	const value = from.get(header)
	if (value != null) {
		to.set(header, value)
	}
}
