// Originally from: https://github.com/patdx/pmil.me/blob/8125a7a04bcf0fa9d32de7fa2ec9713fab6a361d/app/.server/cf-cacher.ts

export type CfCacherProps = {
	getRequest: () => Promise<Request> | Request
	cacheTtl?: number // seconds; default is 1 year (31536000)
}

export const RESOLVED_URL_HEADER = 'x-og-parser-resolved-url'

export async function cfCacher({ getRequest, cacheTtl = 31536000 }: CfCacherProps): Promise<Response> {
	const request = await getRequest()
	console.log(`Using built-in CF caching for: ${request.url}.`)

	try {
		const response = await fetch(request, { cf: { cacheEverything: true, cacheTtl } })
		const cacheStatus = response.headers.get('cf-cache-status')
		console.log(`Cache status: ${cacheStatus}`)
		return response
	} catch (error) {
		if (!isRedirectLoopError(error)) {
			throw error
		}

		const message = error instanceof Error ? error.message : String(error)
		console.warn(`CF cache fetch failed for ${request.url}; retrying without CF cache. ${message}`)

		const retryRequest = await getRequest()
		const response = await fetch(retryRequest)
		return cloneResponse(response, {
			'cf-cache-status': 'BYPASS',
			[RESOLVED_URL_HEADER]: response.url || retryRequest.url,
		})
	}
}

function cloneResponse(response: Response, headers: Record<string, string>): Response {
	const clonedResponse = new Response(response.body, response)

	for (const [name, value] of Object.entries(headers)) {
		clonedResponse.headers.set(name, value)
	}

	return clonedResponse
}

function isRedirectLoopError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}

	return /too many redirects/i.test(error.message)
}
