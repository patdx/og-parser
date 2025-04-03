export interface OpenGraphData {
	requestUrl: string // The original request URL
	resolvedUrl: string // The final URL after redirects
	title?: string
	description?: string
	image?: string
	siteName?: string
	type?: string
	htmlLang?: string
	metadata: Record<string, string>
	ldJsons: any[] // Array of parsed JSON-LD data
	diagnostics: {
		cfColo?: string
		cfCacheStatus?: string
		responseText?: string
	}
}

export interface MetaElementHandler {
	element(element: Element): void
}

export interface ParserResult {
	data: OpenGraphData
}
