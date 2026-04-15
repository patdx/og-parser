import type { OpenGraphData } from '../src/types'

export type NormalizedField =
	| 'title'
	| 'description'
	| 'image'
	| 'image_alt'
	| 'image_width'
	| 'image_height'
	| 'image_type'
	| 'site_name'
	| 'type'
	| 'html_lang'
	| 'locale'
	| 'authors'
	| 'published_at'
	| 'modified_at'
	| 'canonical_url'

export interface ParserQualityExpected {
	sourceUrl: string
	category: string
	reviewStatus: string
	notes?: string
	normalized: Partial<Pick<OpenGraphData, NormalizedField>>
	required_meta_tags: OpenGraphData['meta_tags']
	required_ld_jsons: unknown[]
	missing?: NormalizedField[]
}

export interface ParserQualityFixture {
	id: string
	sourceUrl: string
	category: string
	reviewStatus: string
	notes?: string
	html: string
	expected: ParserQualityExpected
}

const fixtureHtmlById = mapFixtureModules(
	import.meta.glob('./fixtures/parser-quality/*/source.html', {
		eager: true,
		import: 'default',
		query: '?raw',
	}) as Record<string, string>,
	'source.html',
)

const expectedById = mapFixtureModules(
	import.meta.glob('./fixtures/parser-quality/*/expected.json', {
		eager: true,
		import: 'default',
	}) as Record<string, ParserQualityExpected>,
	'expected.json',
)

const fixtureIds = [...new Set([...Object.keys(fixtureHtmlById), ...Object.keys(expectedById)])].sort()

export const parserQualityFixtures: ParserQualityFixture[] = fixtureIds.map((id) => {
	const html = fixtureHtmlById[id]
	const expected = expectedById[id]

	if (!html) {
		throw new Error(`Parser quality fixture ${id} is missing source.html.`)
	}

	if (!expected) {
		throw new Error(`Parser quality fixture ${id} is missing expected.json.`)
	}

	return {
		id,
		sourceUrl: expected.sourceUrl,
		category: expected.category,
		reviewStatus: expected.reviewStatus,
		notes: expected.notes,
		html,
		expected,
	}
})

function mapFixtureModules<T>(modules: Record<string, T>, expectedFileName: string): Record<string, T> {
	const modulesById: Record<string, T> = {}

	for (const [modulePath, value] of Object.entries(modules)) {
		const id = fixtureIdFromModulePath(modulePath, expectedFileName)

		if (id in modulesById) {
			throw new Error(`Duplicate parser quality fixture definition for ${id} (${expectedFileName}).`)
		}

		modulesById[id] = value
	}

	return modulesById
}

function fixtureIdFromModulePath(modulePath: string, expectedFileName: string): string {
	const segments = modulePath.split('/')
	const fileName = segments.at(-1)
	const fixtureId = segments.at(-2)

	if (fileName !== expectedFileName || !fixtureId) {
		throw new Error(`Unexpected parser quality fixture path: ${modulePath}`)
	}

	return fixtureId
}
