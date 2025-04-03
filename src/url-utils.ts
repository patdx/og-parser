export class URLValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'URLValidationError'
	}
}

export function validateAndNormalizeURL(urlString: string): URL {
	const hasProtocol = /^https?:\/\//i.test(urlString)
	if (!hasProtocol) {
		urlString = 'http://' + urlString
	}
	try {
		const url = new URL(urlString)
		if (!url.protocol.startsWith('http')) {
			throw new URLValidationError('URL must use HTTP or HTTPS protocol')
		}
		return url
	} catch (error) {
		if (error instanceof URLValidationError) {
			throw error
		}
		throw new URLValidationError('Invalid URL format')
	}
}

export function extractURLFromRequest(request: Request): string {
	const url = new URL(request.url)
	const path = url.pathname.slice(1) // Remove leading slash
	if (!path) {
		throw new URLValidationError('No URL provided')
	}
	return decodeURIComponent(path)
}
