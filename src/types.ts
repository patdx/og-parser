export interface MetaTag {
	key: string
	content: string
}

export interface OpenGraphData {
	request_url: string // The original request URL
	resolve_url: string // The final URL after redirects
	canonical_url?: string
	title?: string
	description?: string
	image?: string
	image_alt?: string
	image_width?: number
	image_height?: number
	image_type?: string
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
