# Open Graph Parser - Cloudflare Worker

This project is a Cloudflare Worker that parses Open Graph metadata from websites. When given a URL, it fetches the page and extracts Open Graph tags, returning the data as JSON.

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

- Type definitions for Open Graph metadata
- Interface definitions for the parser

## API Usage

```
GET /:url
```

Where `:url` is the URL-encoded address of the webpage to parse.

### Example Response

```json
{
	"url": "https://example.com",
	"title": "Example Title",
	"description": "Page description",
	"image": "https://example.com/image.jpg",
	"siteName": "Example Site",
	"type": "website",
	"metadata": {
		// Additional Open Graph properties found
	}
}
```

## Implementation Notes

- Use Cloudflare's HTMLRewriter for efficient parsing
- Include proper error handling and timeouts
- Implement caching headers for better performance
- Consider rate limiting to prevent abuse
