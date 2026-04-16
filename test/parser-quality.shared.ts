import type { OpenGraphData } from '../src/types'
import { parseOpenGraph } from '../src/og-parser'
import { parserQualityFixtures, type NormalizedField, type ParserQualityFixture } from './parser-quality.fixtures'

type MismatchSeverity = 'critical' | 'major' | 'minor'
type FixtureStatus = 'pass' | 'needs-review' | 'fail'

export interface ParserQualityMismatch {
	field: string
	severity: MismatchSeverity
	expected: unknown
	actual: unknown
	message: string
}

export interface ParserQualityFixtureEvaluation {
	id: string
	sourceUrl: string
	category: string
	status: FixtureStatus
	mismatches: ParserQualityMismatch[]
	actual: Pick<
		OpenGraphData,
		'title' | 'description' | 'images' | 'videos' | 'audio' | 'site_name' | 'type' | 'html_lang' | 'canonical_url'
	> & {
		locale?: string
		authors?: string[]
		published_at?: string
		modified_at?: string
		meta_tag_keys: string[]
		ld_json_types: string[]
	}
}

export interface ParserQualityReport {
	summary: {
		fixtures: number
		pass: number
		needs_review: number
		fail: number
		critical_mismatches: number
		major_mismatches: number
		minor_mismatches: number
	}
	fixtures: ParserQualityFixtureEvaluation[]
}

const criticalFields = new Set<NormalizedField>(['title', 'description', 'images'])
const majorFields = new Set<NormalizedField>([
	'videos',
	'audio',
	'site_name',
	'type',
	'html_lang',
	'canonical_url',
	'locale',
	'authors',
	'published_at',
	'modified_at',
])
const promotedOgKeys = new Set([
	'og:title',
	'og:description',
	'og:image',
	'og:image:url',
	'og:image:secure_url',
	'og:image:alt',
	'og:image:width',
	'og:image:height',
	'og:image:type',
	'og:video',
	'og:video:url',
	'og:video:secure_url',
	'og:video:alt',
	'og:video:width',
	'og:video:height',
	'og:video:type',
	'og:audio',
	'og:audio:url',
	'og:audio:secure_url',
	'og:audio:alt',
	'og:audio:width',
	'og:audio:height',
	'og:audio:type',
	'og:site_name',
	'og:type',
	'og:url',
	'og:locale',
])
const fallbackTwitterKeys = new Set(['twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt'])

export async function evaluateParserQualityFixtures(): Promise<ParserQualityReport> {
	const fixtures = []

	for (const fixture of parserQualityFixtures) {
		fixtures.push(await evaluateParserQualityFixture(fixture))
	}

	const summary = {
		fixtures: fixtures.length,
		pass: fixtures.filter((fixture) => fixture.status === 'pass').length,
		needs_review: fixtures.filter((fixture) => fixture.status === 'needs-review').length,
		fail: fixtures.filter((fixture) => fixture.status === 'fail').length,
		critical_mismatches: fixtures.reduce(
			(count, fixture) => count + fixture.mismatches.filter((mismatch) => mismatch.severity === 'critical').length,
			0,
		),
		major_mismatches: fixtures.reduce(
			(count, fixture) => count + fixture.mismatches.filter((mismatch) => mismatch.severity === 'major').length,
			0,
		),
		minor_mismatches: fixtures.reduce(
			(count, fixture) => count + fixture.mismatches.filter((mismatch) => mismatch.severity === 'minor').length,
			0,
		),
	}

	return {
		summary,
		fixtures,
	}
}

export async function evaluateParserQualityFixture(fixture: ParserQualityFixture): Promise<ParserQualityFixtureEvaluation> {
	const actual = await parseFixture(fixture)
	const mismatches: ParserQualityMismatch[] = []

	for (const [field, expectedValue] of Object.entries(fixture.expected.normalized) as Array<[NormalizedField, unknown]>) {
		if (!matchesSubset(actual[field], expectedValue)) {
			mismatches.push({
				field,
				severity: normalizedFieldSeverity(field),
				expected: expectedValue,
				actual: actual[field],
				message: `Normalized field ${field} did not match.`,
			})
		}
	}

	for (const field of fixture.expected.missing ?? []) {
		if (actual[field] !== undefined) {
			mismatches.push({
				field,
				severity: normalizedFieldSeverity(field),
				expected: undefined,
				actual: actual[field],
				message: `Normalized field ${field} was expected to be absent.`,
			})
		}
	}

	for (const expectedMetaTag of fixture.expected.required_meta_tags) {
		const hasMetaTag = actual.meta_tags.some(
			(actualMetaTag) => actualMetaTag.key === expectedMetaTag.key && actualMetaTag.content === expectedMetaTag.content,
		)
		if (!hasMetaTag) {
			mismatches.push({
				field: `meta_tags[${expectedMetaTag.key}]`,
				severity: 'minor',
				expected: expectedMetaTag,
				actual: actual.meta_tags,
				message: `Meta tag ${expectedMetaTag.key} did not include the expected content.`,
			})
		}
	}

	for (const [index, expectedLdJson] of fixture.expected.required_ld_jsons.entries()) {
		const actualLdJson = actual.ld_jsons[index]
		if (!matchesSubset(actualLdJson, expectedLdJson)) {
			mismatches.push({
				field: `ld_jsons[${index}]`,
				severity: 'major',
				expected: expectedLdJson,
				actual: actualLdJson,
				message: `JSON-LD entry ${index} did not include the expected subset.`,
			})
		}
	}

	const status = determineFixtureStatus(mismatches)

	return {
		id: fixture.id,
		sourceUrl: fixture.sourceUrl,
		category: fixture.category,
		status,
		mismatches,
		actual: {
			title: actual.title,
			description: actual.description,
			images: actual.images,
			videos: actual.videos,
			audio: actual.audio,
			site_name: actual.site_name,
			type: actual.type,
			html_lang: actual.html_lang,
			locale: actual.locale,
			authors: actual.authors,
			published_at: actual.published_at,
			modified_at: actual.modified_at,
			canonical_url: actual.canonical_url,
			meta_tag_keys: [...new Set(actual.meta_tags.map((metaTag) => metaTag.key))].sort(),
			ld_json_types: collectLdJsonTypes(actual.ld_jsons),
		},
	}
}

export async function parseFixture({ sourceUrl, html }: Pick<ParserQualityFixture, 'sourceUrl' | 'html'>): Promise<OpenGraphData> {
	return parseOpenGraph({
		response: new Response(html, {
			headers: {
				'content-type': 'text/html',
			},
		}),
		requestUrl: sourceUrl,
	})
}

export function collectLdJsonTypes(ldJsons: unknown[]): string[] {
	const types = new Set<string>()

	for (const entry of ldJsons) {
		collectNestedLdJsonTypes(entry, types)
	}

	return [...types].sort()
}

export function collectExtraOgKeys(data: OpenGraphData): string[] {
	return collectMetaTagKeys(data)
		.filter((key) => key.startsWith('og:') && !promotedOgKeys.has(key))
		.sort()
}

export function collectExtraTwitterKeys(data: OpenGraphData): string[] {
	return collectMetaTagKeys(data)
		.filter((key) => key.startsWith('twitter:') && !fallbackTwitterKeys.has(key))
		.sort()
}

export function collectKeysByPrefix(data: OpenGraphData, prefix: string): string[] {
	return collectMetaTagKeys(data)
		.filter((key) => key.startsWith(prefix))
		.sort()
}

export function collectOtherMetaKeys(data: OpenGraphData): string[] {
	return collectMetaTagKeys(data)
		.filter((key) => !key.startsWith('og:') && !key.startsWith('twitter:') && !key.startsWith('article:') && key !== 'description')
		.sort()
}

export function collectLdJsonTopLevelKeys(data: OpenGraphData): string[] {
	const keys = new Set<string>()
	const promotedLdJsonKeys = new Set(['url', 'mainEntityOfPage', 'author', 'datePublished', 'dateModified'])

	for (const entry of data.ld_jsons) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			continue
		}

		for (const key of Object.keys(entry)) {
			if (key === '@context' || key === '@type' || key === '@id' || promotedLdJsonKeys.has(key)) {
				continue
			}

			keys.add(key)
		}
	}

	return [...keys].sort()
}

function collectNestedLdJsonTypes(value: unknown, types: Set<string>) {
	if (!value || typeof value !== 'object') {
		return
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectNestedLdJsonTypes(item, types)
		}
		return
	}

	const record = value as Record<string, unknown>
	const typeValue = record['@type']

	if (typeof typeValue === 'string') {
		types.add(typeValue)
	} else if (Array.isArray(typeValue)) {
		for (const item of typeValue) {
			if (typeof item === 'string') {
				types.add(item)
			}
		}
	}

	for (const nestedValue of Object.values(record)) {
		collectNestedLdJsonTypes(nestedValue, types)
	}
}

function determineFixtureStatus(mismatches: ParserQualityMismatch[]): FixtureStatus {
	if (mismatches.some((mismatch) => mismatch.severity === 'critical')) {
		return 'fail'
	}

	if (mismatches.length > 0) {
		return 'needs-review'
	}

	return 'pass'
}

function normalizedFieldSeverity(field: NormalizedField): MismatchSeverity {
	if (criticalFields.has(field)) {
		return 'critical'
	}

	if (majorFields.has(field)) {
		return 'major'
	}

	return 'minor'
}

function matchesSubset(actual: unknown, expected: unknown): boolean {
	if (expected === null || typeof expected !== 'object') {
		return actual === expected
	}

	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length < expected.length) {
			return false
		}

		return expected.every((expectedItem, index) => matchesSubset(actual[index], expectedItem))
	}

	if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
		return false
	}

	return Object.entries(expected).every(([key, expectedValue]) => matchesSubset((actual as Record<string, unknown>)[key], expectedValue))
}

function collectMetaTagKeys(data: OpenGraphData): string[] {
	return [...new Set(data.meta_tags.map((metaTag) => metaTag.key))]
}
