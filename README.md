# Open Graph Parser - Cloudflare Worker

This project is a Cloudflare Worker that fetches web pages and extracts Open Graph and related page signals as JSON.

## Architecture Overview

1. **URL Handling**: The worker accepts requests with a URL parameter and validates it
2. **Page Fetching**: Fetches the target webpage content
3. **HTML Parsing**: Uses Cloudflare's HTMLRewriter to parse the HTML and extract Open Graph tags
4. **Response Formatting**: Returns the parsed data as a structured JSON response

## Key Components

### 1. Main Worker Handler (`src/index.ts`)

- Processes incoming requests
- Validates URL parameters
- Calls fetching and parsing functionality
- Returns JSON response

### 2. OG Parser Module (`src/og-parser.ts`)

- Contains the HTMLRewriter implementation
- Defines element handlers for extracting meta tags
- Processes and structures the extracted data

### 3. URL Utilities (`src/url-utils.ts`)

- URL validation and normalization
- Helper functions for processing URLs

### 4. Types (`src/types.ts`)

- Type definitions for parser output and extracted page signals
- Interface definitions for the parser

## API Usage

```
GET /:url
```

Where `:url` is the URL-encoded address of the webpage to parse.

### Example Response

```json
{
	"request_url": "https://example.com",
	"resolve_url": "https://example.com",
	"canonical_url": "https://example.com/article",
	"title": "Example Title",
	"description": "Page description",
	"images": [
		{
			"url": "https://example.com/image.jpg",
			"alt": "Example image alt text",
			"width": 1200,
			"height": 630,
			"type": "image/jpeg"
		}
	],
	"videos": [
		{
			"url": "https://example.com/video.mp4",
			"width": 1280,
			"height": 720,
			"type": "video/mp4"
		}
	],
	"audio": [
		{
			"url": "https://example.com/audio.mp3",
			"type": "audio/mpeg"
		}
	],
	"site_name": "Example Site",
	"type": "website",
	"locale": "en_US",
	"authors": ["Ada Lovelace"],
	"published_at": "2024-01-02T03:04:05Z",
	"modified_at": "2024-01-03T04:05:06Z",
	"meta_tags": [
		// Ordered parsed meta name/property values, including those also promoted above
	],
	"ld_jsons": [
		// Flattened JSON-LD objects from every application/ld+json script block
	]
}
```

## Implementation Notes

- Use Cloudflare's HTMLRewriter for efficient parsing
- Include proper error handling and timeouts
- Implement caching headers for better performance
- Consider rate limiting to prevent abuse

## Parser Quality Fixtures

- `test/parser-quality.spec.ts` exercises the parser against reduced snapshots taken from real public pages instead of live network responses.
- Each fixture lives in its own directory under `test/fixtures/parser-quality/<fixture-id>/` with a `source.html` snapshot and a colocated `expected.json` containing both fixture metadata and the human-reviewed gold expectations.
- The fixture loader uses eager Vite glob imports, so the Cloudflare Vitest worker runtime consumes bundled fixture modules instead of reading snapshot files through Node at test runtime.
- `pnpm run evaluate:parser-quality` writes machine-readable reports to `artifacts/parser-quality/`, and `pnpm run score:parser-quality` summarizes the report with a failing exit code if critical mismatches appear.
- Each fixture locks in expected normalized fields and contributes to a schema-watch report that highlights uncaptured `og:*`, `twitter:*`, `article:*`, other structured meta keys, and JSON-LD signals.
- When adding a new fixture, prefer a small reduced HTML snapshot that keeps the original page's parser-relevant tags (`<html lang>`, relevant `<meta>`, and any `application/ld+json` blocks), then define its `sourceUrl`, `category`, `reviewStatus`, and assertions in the colocated `expected.json`.
