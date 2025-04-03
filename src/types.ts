export interface OpenGraphData {
	url: string
	title?: string
	description?: string
	image?: string
	siteName?: string
	type?: string
	metadata: Record<string, string>
}

export interface MetaElementHandler {
	element(element: Element): void
}

export interface ParserResult {
	data: OpenGraphData
}
