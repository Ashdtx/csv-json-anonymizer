# CSV/JSON Anonymization Review Tool

A browser-based tool to review CSV/JSON datasets, configure anonymization rules, preview before/after changes, apply transformations to the full file, and export cleaned data.

## Features

- Upload CSV or JSON (array of objects)
- File summary (rows, columns)
- Column inspector: type guess, empty ratio, distinct count, sample values
- Suggestions: empty/mostly-empty/constant/technical/sensitive-like columns
- Per-column actions: keep/remove/clear/mask/anonymize
- Free-text anonymization for emails, phones, IDs, usernames + name-like columns
- Side-by-side before/after preview with change highlighting
- Full apply with progress + transformation summary
- Export anonymized CSV and JSON
- Config persistence in localStorage
- Export/import config JSON for reuse

## Run locally

Open `index.html` directly in browser, or serve with any static server.

## Deploy notes

Can be deployed as static files under nginx, e.g. `/var/www/html/csv-json-anonymizer/`.
