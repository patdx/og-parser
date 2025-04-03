import { validateAndNormalizeURL, extractURLFromRequest, URLValidationError } from './url-utils'
import { parseOpenGraph } from './og-parser'

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

		const key = 'default'
		const { success } = await env.MY_RATE_LIMITER.limit({ key: key }) // key can be any string of your choosing
		if (!success) {
			return new Response(`429 Failure – rate limit exceeded for ${key}`, { status: 429 })
		}

		try {
			// Extract and validate the target URL
			const targetUrl = extractURLFromRequest(request)
			const validatedUrl = validateAndNormalizeURL(targetUrl)

			// Fetch the target page
			const response = await fetch(validatedUrl.toString(), {
				headers: {
					'User-Agent': 'OG-Parser Bot/1.0',
				},
				redirect: 'follow',
			})

			if (!response.ok) {
				throw new Error(`Failed to fetch URL: ${response.status}`)
			}

			// Parse the Open Graph data
			const ogData = await parseOpenGraph(response, validatedUrl.toString())

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
