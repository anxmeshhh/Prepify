# Prepify

**Search any company and get its interview process, reported questions and candidate experiences in one structured page, with a source on every item.**

Type a query the way you would on Google, for example `Target Corporation interview questions`. Prepify works out the company, role and what you want, and shows a numbered report built only from the interview evidence it has saved. Every question links back to where it came from.

## Features

- **Google-style search.** A single search box, with a results page laid out in numbered sections: overview, interview rounds, questions grouped by subject, candidate experience and sources.
- **Natural-language queries.** "I want to prepare for Accenture for the Associate Software Engineer role" is read as company `Accenture`, role `Associate Software Engineer`.
- **Evidence only.** Questions come from saved reports, never from AI guesses. Duplicate questions are merged and counted ("reported 2×").
- **Research sources.** One click opens Glassdoor, AmbitionBox and Google for the company, and makes that company the capture target.
- **Prepify Capture (Chrome extension).** On an interview or review page you are viewing, click **Save to Prepify** to save the questions and reviews into your local database. You can also right-click selected text and choose "Save selection to Prepify".
- **Workspace.** Manage companies, roles, questions and reviews, and write practice answers.

## Run it

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000.

### Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.

## Project layout

| Path | What it is |
| --- | --- |
| `app.py` | Flask API, query parser and SQLite schema |
| `templates/search.html`, `static/search.*` | Search home page and results page |
| `templates/index.html`, `static/script.js`, `static/style.css` | Workspace |
| `extension/` | Prepify Capture Chrome extension (Manifest V3) |
| `data/` | Local SQLite database (git-ignored) |

## Data sources and terms

Glassdoor and AmbitionBox do not allow automated scraping, and neither offers a public API. Prepify does not crawl them. The extension only saves pages that you open and view yourself, keeps that data on your machine, and never redistributes it. A multi-user version needs licensed data or other permitted sources. See the discovery report for the full analysis.

## Roadmap

1. Finish discovery: walk both sites in a browser and confirm their terms.
2. Evidence core: a FastAPI backend, an evidence schema and search-API adapters.
3. Processing: question merging, round extraction, and flags for conflicting or outdated reports.
4. Results UI: an 11-section report with collapsible sections.
5. More permitted sources.
6. Launch.
