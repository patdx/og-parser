import { describe, expect, it } from 'vitest'

import { parserQualityFixtures } from './parser-quality.fixtures'
import {
	collectExtraOgKeys,
	collectExtraTwitterKeys,
	collectKeysByPrefix,
	collectLdJsonTopLevelKeys,
	collectLdJsonTypes,
	collectOtherMetaKeys,
	evaluateParserQualityFixtures,
	parseFixture,
} from './parser-quality.shared'

describe('parser quality fixtures', () => {
	it.each(parserQualityFixtures)('parses the reduced real-site snapshot for $id', async ({ sourceUrl, expected, ...fixture }) => {
		const result = await parseFixture({ sourceUrl, html: fixture.html })

		expect(result).toMatchObject({
			request_url: sourceUrl,
			resolve_url: sourceUrl,
			...expected.normalized,
			ld_jsons: expected.required_ld_jsons,
		})

		for (const expectedMetaTag of expected.required_meta_tags) {
			expect(result.meta_tags).toContainEqual(expectedMetaTag)
		}

		for (const field of expected.missing ?? []) {
			expect(result[field]).toBeUndefined()
		}
	})

	it('emits a machine-readable parser quality report when requested', async () => {
		const shouldEmitReport =
			(import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_PARSER_QUALITY_EMIT_REPORT === '1'
		if (!shouldEmitReport) {
			return
		}

		const report = await evaluateParserQualityFixtures()
		console.log(`__PARSER_QUALITY_REPORT__${JSON.stringify(report)}`)
	})

	it('surfaces schema-watch candidates across the fixture set', async () => {
		const report = []

		for (const fixture of parserQualityFixtures) {
			const data = await parseFixture(fixture)
			report.push({
				id: fixture.id,
				extra_og_keys: collectExtraOgKeys(data),
				extra_twitter_keys: collectExtraTwitterKeys(data),
				article_keys: collectKeysByPrefix(data, 'article:'),
				other_meta_keys: collectOtherMetaKeys(data),
				ld_json_top_level_keys: collectLdJsonTopLevelKeys(data),
				ld_json_types: collectLdJsonTypes(data.ld_jsons),
			})
		}

		expect(report).toEqual([
			{
				id: 'apple-iphone',
				extra_og_keys: [],
				extra_twitter_keys: ['twitter:card', 'twitter:site'],
				article_keys: [],
				other_meta_keys: ['al:ios:app_name', 'al:ios:app_store_id', 'al:ios:url'],
				ld_json_top_level_keys: ['description', 'image', 'name'],
				ld_json_types: ['Brand'],
			},
			{
				id: 'britannica-otter',
				extra_og_keys: [],
				extra_twitter_keys: ['twitter:card', 'twitter:site'],
				article_keys: [],
				other_meta_keys: [],
				ld_json_top_level_keys: ['description', 'headline', 'image', 'keywords', 'publisher', 'sameAs', 'wordcount'],
				ld_json_types: ['Article', 'ImageObject', 'Organization', 'Person'],
			},
			{
				id: 'goodreads-the-great-gatsby',
				extra_og_keys: [],
				extra_twitter_keys: ['twitter:card'],
				article_keys: [],
				other_meta_keys: [],
				ld_json_top_level_keys: ['aggregateRating', 'awards', 'bookFormat', 'image', 'inLanguage', 'isbn', 'name', 'numberOfPages'],
				ld_json_types: ['AggregateRating', 'Book', 'Person'],
			},
			{
				id: 'mdn-fetch-api',
				extra_og_keys: [],
				extra_twitter_keys: ['twitter:card', 'twitter:creator'],
				article_keys: [],
				other_meta_keys: [],
				ld_json_top_level_keys: [],
				ld_json_types: [],
			},
			{
				id: 'wikipedia-open-graph-protocol',
				extra_og_keys: [],
				extra_twitter_keys: [],
				article_keys: [],
				other_meta_keys: [],
				ld_json_top_level_keys: [],
				ld_json_types: [],
			},
		])
	})
})
