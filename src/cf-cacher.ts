// Originally from: https://github.com/patdx/pmil.me/blob/8125a7a04bcf0fa9d32de7fa2ec9713fab6a361d/app/.server/cf-cacher.ts

export type CfCacherProps = {
	cacheKey: string
	// getFreshValue returns a Request
	getFreshValue: () => Promise<Request>
	useCfFetch?: boolean
	cacheTtl?: number // seconds; default is 1 year (31536000)
	executionCtx: ExecutionContext
}

export async function cfCacher({
	cacheKey,
	getFreshValue,
	useCfFetch = false,
	cacheTtl = 31536000,
	executionCtx,
}: CfCacherProps): Promise<Response> {
	const cache = (caches as any).default as Cache

	if (useCfFetch) {
		console.log(`Using built-in CF caching for: ${cacheKey}.`)
		const request = await getFreshValue()
		const response = await fetch(request, { cf: { cacheKey, cacheEverything: true, cacheTtl } })
		const cacheStatus = response.headers.get('cf-cache-status')
		console.log(`Cache status: ${cacheStatus}`)
		return response
	} else {
		let response = (await cache.match(cacheKey)) as unknown as Response

		if (!response) {
			console.log(`Response for request url: ${cacheKey} not present in cache. Fetching and caching request.`)
			const request = await getFreshValue()
			response = await fetch(request)
			// Must use Response constructor to inherit all of response's fields
			response = new Response(response.body, response)

			// Set Cache-Control header to instruct the cache to store the response for cacheTtl seconds
			response.headers.set('Cache-Control', `s-maxage=${cacheTtl}`)

			executionCtx.waitUntil(cache.put(cacheKey, response.clone() as any))
		} else {
			console.log(`Cache hit for: ${cacheKey}.`)
		}

		return response
	}
}
