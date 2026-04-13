import { OpenGraphData, ParserResult } from './types'

class HtmlHandler implements HTMLRewriterElementContentHandlers {
	constructor(private result: ParserResult) {}

	element(element: Element): void {
		const lang = element.getAttribute('lang')
		if (lang) {
			this.result.data.htmlLang = lang
		}
	}
}

class MetaHandler implements HTMLRewriterElementContentHandlers {
	constructor(private result: ParserResult) {}

	element(element: Element): void {
		const property = element.getAttribute('property') || element.getAttribute('name')
		const content = element.getAttribute('content')

		if (!property || !content) return

		const propertyLower = property.toLowerCase()

		if (propertyLower.startsWith('og:')) {
			const key = propertyLower.substring(3)
			switch (key) {
				case 'title':
					this.result.data.title = content
					break
				case 'description':
					this.result.data.description = content
					break
				case 'image':
					this.result.data.image = content
					break
				case 'site_name':
					this.result.data.siteName = content
					break
				case 'type':
					this.result.data.type = content
					break
				default:
					this.result.data.metadata[propertyLower] = content
			}
		}
	}
}

class ScriptHandler implements HTMLRewriterElementContentHandlers {
	private textChunks: string[] = []
	private isCapturingLdJson = false

	constructor(private result: ParserResult) {
		if (!this.result.data.ldJsons) {
			this.result.data.ldJsons = []
		}
	}

	text(text: Text) {
		if (this.isCapturingLdJson) {
			this.textChunks.push(text.text)
		}
	}

	element(element: Element) {
		const type = element.getAttribute('type')?.trim().toLowerCase()
		if (type !== 'application/ld+json') {
			this.isCapturingLdJson = false
			this.textChunks = []
			return
		}

		this.isCapturingLdJson = true
		this.textChunks = []
		element.onEndTag(() => this.flush())
	}

	comments(comment: Comment) {
		// Ignore comments
	}

	private flush() {
		if (!this.isCapturingLdJson) {
			return
		}

		const jsonText = this.textChunks.join('').trim()
		try {
			const parsedData = JSON.parse(jsonText)
			this.result.data.ldJsons.push(parsedData)
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			console.error(`Failed to parse JSON-LD: ${message}, text: ${jsonText}`)
			// Silently ignore invalid JSON
		}
		this.isCapturingLdJson = false
		this.textChunks = []
	}
}

export async function parseOpenGraph({
	response,
	requestUrl,
	cfColo,
	cfCacheStatus,
}: {
	response: Response
	requestUrl: string
	cfColo?: string
	cfCacheStatus?: string
}): Promise<OpenGraphData> {
	const result: ParserResult = {
		data: {
			requestUrl,
			resolvedUrl: response.url,
			title: undefined,
			description: undefined,
			image: undefined,
			siteName: undefined,
			type: undefined,
			htmlLang: undefined,
			metadata: {},
			ldJsons: [],
			diagnostics: {
				cfColo,
				cfCacheStatus,
			},
		},
	}

	const rewriter = new HTMLRewriter()
		.on('meta', new MetaHandler(result))
		.on('html', new HtmlHandler(result))
		.on('script', new ScriptHandler(result))

	await rewriter.transform(response).text()

	return result.data
}
