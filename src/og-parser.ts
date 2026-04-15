import { RESOLVED_URL_HEADER } from './cf-cacher'
import { MetaTag, OpenGraphData, ParserResult } from './types'

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
	constructor(private result: ParserResult) {}

	element(element: Element): void {
		const property = element.getAttribute('property') || element.getAttribute('name')
		const content = element.getAttribute('content')

		if (!property || !content) return

		this.result.data.meta_tags.push({
			key: property.toLowerCase(),
			content,
		})
	}
}

type OgImageGroup = {
	image?: string
	secure_url?: string
	alt?: string
	width?: number
	height?: number
	type?: string
}

type StructuredDataSummary = {
	authors: string[]
	published_at?: string
	modified_at?: string
}

class MetaTagDeriver {
	private currentOgImageGroup?: OgImageGroup
	private selectedOgImageGroup?: OgImageGroup
	private hasSelectedSecureOgImage = false

	constructor(private result: OpenGraphData) {}

	apply(metaTags: MetaTag[]) {
		for (const metaTag of metaTags) {
			this.applyOne(metaTag)
		}
	}

	private applyOne(metaTag: MetaTag) {
		const key = metaTag.key.toLowerCase()
		const { content } = metaTag

		switch (key) {
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

		if (!key.startsWith('og:')) {
			return
		}

		switch (key.substring(3)) {
			case 'title':
				this.result.title = content
				break
			case 'description':
				this.result.description = content
				break
			case 'locale':
				this.result.locale = content
				break
			case 'url':
				this.result.canonical_url = content
				break
			case 'image':
				this.getOgImageGroupForPrimaryTag('image').image = content
				if (!this.hasSelectedSecureOgImage) {
					this.selectedOgImageGroup = this.currentOgImageGroup
				}
				this.syncSelectedOgImageGroup()
				break
			case 'image:secure_url':
				this.getOgImageGroupForPrimaryTag('secure_url').secure_url = content
				this.hasSelectedSecureOgImage = true
				this.selectedOgImageGroup = this.currentOgImageGroup
				this.syncSelectedOgImageGroup()
				break
			case 'image:alt':
				this.getCurrentOgImageGroup().alt = content
				this.syncSelectedOgImageGroupIfCurrentIsSelected()
				break
			case 'image:width':
				this.getCurrentOgImageGroup().width = parseIntegerMeta(content)
				this.syncSelectedOgImageGroupIfCurrentIsSelected()
				break
			case 'image:height':
				this.getCurrentOgImageGroup().height = parseIntegerMeta(content)
				this.syncSelectedOgImageGroupIfCurrentIsSelected()
				break
			case 'image:type':
				this.getCurrentOgImageGroup().type = content
				this.syncSelectedOgImageGroupIfCurrentIsSelected()
				break
			case 'site_name':
				this.result.site_name = content
				break
			case 'type':
				this.result.type = content
				break
		}
	}

	private setIfMissing(field: 'title' | 'description', content: string) {
		if (!this.result[field]) {
			this.result[field] = content
		}
	}

	private setImageIfMissing(content: string) {
		if (!this.result.image && !this.selectedOgImageGroup) {
			this.result.image = content
		}
	}

	private getCurrentOgImageGroup(): OgImageGroup {
		if (!this.currentOgImageGroup) {
			this.currentOgImageGroup = {}
		}

		return this.currentOgImageGroup as OgImageGroup
	}

	private getOgImageGroupForPrimaryTag(key: 'image' | 'secure_url'): OgImageGroup {
		const currentGroup = this.getCurrentOgImageGroup()
		if (currentGroup[key] !== undefined) {
			this.currentOgImageGroup = {}
		}

		return this.getCurrentOgImageGroup()
	}

	private syncSelectedOgImageGroupIfCurrentIsSelected() {
		if (this.currentOgImageGroup === this.selectedOgImageGroup) {
			this.syncSelectedOgImageGroup()
		}
	}

	private syncSelectedOgImageGroup() {
		if (!this.selectedOgImageGroup) {
			return
		}

		this.result.image = this.selectedOgImageGroup.secure_url ?? this.selectedOgImageGroup.image
		this.result.image_alt = this.selectedOgImageGroup.alt
		this.result.image_width = this.selectedOgImageGroup.width
		this.result.image_height = this.selectedOgImageGroup.height
		this.result.image_type = this.selectedOgImageGroup.type
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

export async function extractOpenGraphData({
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
			canonical_url: undefined,
			title: undefined,
			description: undefined,
			image: undefined,
			image_alt: undefined,
			image_width: undefined,
			image_height: undefined,
			image_type: undefined,
			site_name: undefined,
			type: undefined,
			html_lang: undefined,
			locale: undefined,
			authors: undefined,
			published_at: undefined,
			modified_at: undefined,
			meta_tags: [],
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

export function deriveOpenGraphData(data: OpenGraphData): OpenGraphData {
	const result: OpenGraphData = {
		...data,
		canonical_url: undefined,
		title: undefined,
		description: undefined,
		image: undefined,
		image_alt: undefined,
		image_width: undefined,
		image_height: undefined,
		image_type: undefined,
		site_name: undefined,
		type: undefined,
		locale: undefined,
		authors: undefined,
		published_at: undefined,
		modified_at: undefined,
	}

	new MetaTagDeriver(result).apply(result.meta_tags)

	if (!result.canonical_url) {
		result.canonical_url = inferCanonicalUrlFromLdJsons(result.ld_jsons)
	}

	const structuredDataSummary = inferStructuredDataSummary(result.ld_jsons)
	if (structuredDataSummary.authors.length > 0) {
		result.authors = structuredDataSummary.authors
	}
	result.published_at = structuredDataSummary.published_at
	result.modified_at = structuredDataSummary.modified_at

	return result
}

export async function parseOpenGraph(args: {
	response: Response
	requestUrl: string
	cfColo?: string
	cfCacheStatus?: string
}): Promise<OpenGraphData> {
	return deriveOpenGraphData(await extractOpenGraphData(args))
}

function inferCanonicalUrlFromLdJsons(ldJsons: unknown[]): string | undefined {
	for (const entry of ldJsons) {
		const candidate = inferCanonicalUrlFromLdJsonEntry(entry)
		if (candidate) {
			return candidate
		}
	}

	return undefined
}

function inferCanonicalUrlFromLdJsonEntry(entry: unknown): string | undefined {
	for (const candidateEntry of collectRelevantLdJsonEntries(entry)) {
		const candidate = extractCanonicalUrlFromRelevantLdJsonEntry(candidateEntry)
		if (candidate) {
			return candidate
		}
	}

	return undefined
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.length > 0) {
			return value
		}
	}

	return undefined
}

function parseIntegerMeta(value: string): number | undefined {
	if (!/^\d+$/.test(value)) {
		return undefined
	}

	return Number.parseInt(value, 10)
}

function inferStructuredDataSummary(ldJsons: unknown[]) {
	const authors = new Set<string>()
	let publishedAt: string | undefined
	let modifiedAt: string | undefined

	for (const entry of ldJsons) {
		const summary = inferStructuredDataSummaryFromEntry(entry)
		for (const author of summary.authors) {
			authors.add(author)
		}
		publishedAt ??= summary.published_at
		modifiedAt ??= summary.modified_at
	}

	return {
		authors: [...authors],
		published_at: publishedAt,
		modified_at: modifiedAt,
	}
}

function inferStructuredDataSummaryFromEntry(entry: unknown): StructuredDataSummary {
	return collectRelevantLdJsonEntries(entry).reduce<StructuredDataSummary>(
		(summary, candidateEntry) => mergeStructuredDataSummaries(summary, extractStructuredDataSummaryFromRelevantLdJsonEntry(candidateEntry)),
		{
			authors: [] as string[],
			published_at: undefined,
			modified_at: undefined,
		},
	)
}

function collectRelevantLdJsonEntries(entry: unknown, fromMainEntity = false): Record<string, unknown>[] {
	if (!entry || typeof entry !== 'object') {
		return []
	}

	if (Array.isArray(entry)) {
		return entry.flatMap((item) => collectRelevantLdJsonEntries(item, fromMainEntity))
	}

	const record = entry as Record<string, unknown>
	const entries: Record<string, unknown>[] = []

	if (fromMainEntity || isRelevantLdJsonEntry(record)) {
		entries.push(record)
	}

	entries.push(...collectRelevantLdJsonEntries(record['@graph']))
	entries.push(...collectRelevantLdJsonEntries(record.mainEntity, true))

	return entries
}

function extractCanonicalUrlFromRelevantLdJsonEntry(record: Record<string, unknown>): string | undefined {
	const directMainEntityOfPage = typeof record.mainEntityOfPage === 'string' ? record.mainEntityOfPage : undefined
	if (directMainEntityOfPage) {
		return directMainEntityOfPage
	}

	const nestedMainEntityOfPage = record.mainEntityOfPage
	if (nestedMainEntityOfPage && typeof nestedMainEntityOfPage === 'object' && !Array.isArray(nestedMainEntityOfPage)) {
		const nestedUrl = firstString(
			(nestedMainEntityOfPage as Record<string, unknown>).url,
			(nestedMainEntityOfPage as Record<string, unknown>)['@id'],
		)
		if (nestedUrl) {
			return nestedUrl
		}
	}

	return firstString(record.url)
}

function extractStructuredDataSummaryFromRelevantLdJsonEntry(record: Record<string, unknown>): StructuredDataSummary {
	return {
		authors: extractAuthorNames(record.author),
		published_at: typeof record.datePublished === 'string' ? record.datePublished : undefined,
		modified_at: typeof record.dateModified === 'string' ? record.dateModified : undefined,
	}
}

function isRelevantLdJsonEntry(record: Record<string, unknown>): boolean {
	if (record.mainEntityOfPage !== undefined) {
		return true
	}

	const types = extractLdJsonTypes(record['@type'])
	if (types.some((type) => type.endsWith('page') || type.endsWith('article') || type.endsWith('posting'))) {
		return true
	}

	const hasPageLevelSignals =
		typeof record.url === 'string' ||
		typeof record.headline === 'string' ||
		typeof record.name === 'string' ||
		record.author !== undefined ||
		typeof record.datePublished === 'string' ||
		typeof record.dateModified === 'string'

	return hasPageLevelSignals && !types.every((type) => AUXILIARY_LD_JSON_TYPES.has(type))
}

function extractLdJsonTypes(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value.toLowerCase()]
	}

	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase())
	}

	return []
}

const AUXILIARY_LD_JSON_TYPES = new Set([
	'aggregateoffer',
	'aggregaterating',
	'brand',
	'breadcrumblist',
	'entrypoint',
	'imageobject',
	'listitem',
	'offer',
	'organization',
	'person',
	'rating',
	'searchaction',
	'website',
])

function mergeStructuredDataSummaries(left: StructuredDataSummary, right: StructuredDataSummary): StructuredDataSummary {
	return {
		authors: [...new Set([...left.authors, ...right.authors])],
		published_at: left.published_at ?? right.published_at,
		modified_at: left.modified_at ?? right.modified_at,
	}
}

function extractAuthorNames(value: unknown): string[] {
	if (!value) {
		return []
	}

	if (typeof value === 'string') {
		return [value]
	}

	if (Array.isArray(value)) {
		return value.flatMap((item) => extractAuthorNames(item))
	}

	if (typeof value === 'object') {
		const record = value as Record<string, unknown>
		if (typeof record.name === 'string') {
			return [record.name]
		}
	}

	return []
}
