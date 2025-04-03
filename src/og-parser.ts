import { OpenGraphData, ParserResult } from './types'

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
					this.result.data.metadata[key] = content
			}
		}
	}
}

export async function parseOpenGraph(response: Response, url: string): Promise<OpenGraphData> {
	const result: ParserResult = {
		data: {
			url,
			metadata: {},
		},
	}

	const rewriter = new HTMLRewriter().on('meta', new MetaHandler(result))

	await rewriter.transform(response).text()

	return result.data
}
