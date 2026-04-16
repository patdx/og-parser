export interface MetaTag {
	key: string
	content: string
}

export interface OpenGraphMedia {
	url: string
	alt?: string
	width?: number
	height?: number
	type?: string
}

export interface OpenGraphData {
	request_url: string // The original request URL
	resolve_url: string // The final URL after redirects
	canonical_url?: string
	title?: string
	description?: string
	images?: OpenGraphMedia[]
	videos?: OpenGraphMedia[]
	audio?: OpenGraphMedia[]
	site_name?: string
	type?: string
	html_lang?: string
	locale?: string
	authors?: string[]
	published_at?: string
	modified_at?: string
	meta_tags: MetaTag[]
	ld_jsons: unknown[] // Array of parsed JSON-LD data
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
