export interface OpenGraphData {
	requestUrl: string // The original request URL
	resolvedUrl: string // The final URL after redirects
	title?: string
	description?: string
	image?: string
	siteName?: string
	type?: string
	metadata: Record<string, string>
	diagnostics: {
		cfColo?: string
		cfCacheStatus?: string
	}
}

export interface MetaElementHandler {
	element(element: Element): void
}

export interface ParserResult {
	data: OpenGraphData
}
