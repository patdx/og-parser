import { RESOLVED_URL_HEADER } from './cf-cacher'
import { OpenGraphData, ParserResult } from './types'

class HtmlHandler implements HTMLRewriterElementContentHandlers {
	constructor(private result: ParserResult) {}

	element(element: Element): void {
		const lang = element.getAttribute('lang')
		if (lang) {
			this.result.data.html_lang = lang
		}
	}
}

class MetaHandler implements HTMLRewriterElementContentHandlers {
	private hasSecureOgImage = false

	constructor(private result: ParserResult) {}

	element(element: Element): void {
		const property = element.getAttribute('property') || element.getAttribute('name')
		const content = element.getAttribute('content')

		if (!property || !content) return

		const propertyLower = property.toLowerCase()
		this.result.data.metadata[propertyLower] = content

		switch (propertyLower) {
			case 'description':
				this.setIfMissing('description', content)
				return
			case 'twitter:title':
				this.setIfMissing('title', content)
				return
			case 'twitter:description':
				this.setIfMissing('description', content)
				return
			case 'twitter:image':
				this.setImageIfMissing(content)
				return
		}

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
					if (!this.hasSecureOgImage) {
						this.result.data.image = content
					}
					break
				case 'image:secure_url':
					this.hasSecureOgImage = true
					this.result.data.image = content
					break
				case 'site_name':
					this.result.data.site_name = content
					break
				case 'type':
					this.result.data.type = content
					break
				default:
					this.result.data.metadata[propertyLower] = content
			}
		}
	}

	private setIfMissing(field: 'title' | 'description', content: string) {
		if (!this.result.data[field]) {
			this.result.data[field] = content
		}
	}

	private setImageIfMissing(content: string) {
		if (!this.result.data.image && !this.hasSecureOgImage) {
			this.result.data.image = content
		}
	}
}

class ScriptHandler implements HTMLRewriterElementContentHandlers {
	private textChunks: string[] = []
	private isCapturingLdJson = false

	constructor(private result: ParserResult) {
		if (!this.result.data.ld_jsons) {
			this.result.data.ld_jsons = []
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
			if (Array.isArray(parsedData)) {
				this.result.data.ld_jsons.push(...parsedData)
			} else {
				this.result.data.ld_jsons.push(parsedData)
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			const jsonPreview = jsonText.replaceAll(/\s+/g, ' ').slice(0, 500)
			console.error(`Failed to parse JSON-LD: ${message}, text preview: ${jsonPreview}`)
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
			request_url: requestUrl,
			resolve_url: response.url || response.headers.get(RESOLVED_URL_HEADER) || requestUrl,
			title: undefined,
			description: undefined,
			image: undefined,
			site_name: undefined,
			type: undefined,
			html_lang: undefined,
			metadata: {},
			ld_jsons: [],
			diagnostics: {
				cf_colo: cfColo,
				cf_cache_status: cfCacheStatus,
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
