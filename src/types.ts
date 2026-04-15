export interface OpenGraphData {
	request_url: string // The original request URL
	resolve_url: string // The final URL after redirects
	title?: string
	description?: string
	image?: string
	site_name?: string
	type?: string
	html_lang?: string
	metadata: Record<string, string>
	ld_jsons: any[] // Array of parsed JSON-LD data
	diagnostics: {
		cf_colo?: string
		cf_cache_status?: string
		response_text?: string
	}
}

export interface MetaElementHandler {
	element(element: Element): void
}

export interface ParserResult {
	data: OpenGraphData
}
