# Prepify

**Search any company and get its interview process, reported questions with answers, and candidate experiences in one structured page, with a source on every item.**

Type a query the way you would on Google, for example `Target Corporation interview questions`. Prepify works out the company, role and what you want, then shows the results as one box per source site. Click a box to see everything from that site inside Prepify: questions, their answers, reviews, and the pages they came from.

## Privacy by design: no database

- The server is **stateless**. It only parses search queries and handles optional sign-in. It stores nothing.
- Everything pulled from Glassdoor or AmbitionBox goes from the extension straight into **your browser tab** (`sessionStorage`). Closing the tab, signing out or clicking "clear this session's data" erases it.
- Prepify never sees your Glassdoor or AmbitionBox password. The extension reads those sites through your own Chrome, where you are already signed in.

## Two modes

| | Guest (no account) | Signed in with Google |
| --- | --- | --- |
| Search and query understanding | yes | yes |
| Links to Glassdoor, AmbitionBox and Google for the company | yes | yes |
| Pull questions, answers and reviews into Prepify | no | yes |
| Source boxes, per-site view with answers, merged report | no | yes |
| What Prepify keeps about you | nothing | your name and email in a session cookie, until you sign out or close the browser |

Signing in with Google only identifies you to Prepify. It can't log you in to Glassdoor or AmbitionBox, because Google sign-in tokens only work for the app they were issued to. That's why the extension uses your existing Chrome sessions for those sites.

## Run it

```bash
pip install -r requirements.txt
python app.py                      # guest mode works out of the box
```

Open http://localhost:5000.

### Enable Google sign-in

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
2. Add `http://localhost:5000` as an authorised JavaScript origin.
3. Start Prepify with the client ID. Optionally set a fixed `PREPIFY_SECRET` so sessions survive restarts.

```bash
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com python app.py
```

PowerShell: `$env:GOOGLE_CLIENT_ID="xxxxxxxx.apps.googleusercontent.com"; python app.py`

### Load the extension (needed for pulling)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder. After an update, click the reload icon on the card.
3. In the same Chrome, sign in to Glassdoor and AmbitionBox once.

When you click a source box, the extension opens that site in a background tab and finds the company's interview page. It opens at most three pages per site, with no pagination or crawling. It reads the questions, answers and reviews, hands them to your Prepify tab and closes the background tab. You can also click **Save to Prepify** on any page you're viewing, or right-click selected text.

## Project layout

| Path | What it is |
| --- | --- |
| `app.py` | Flask: query parser (`/api/parse`) and Google sign-in (`/api/auth/*`), no database |
| `templates/search.html`, `static/search.*` | Search home page, results page and in-tab session store |
| `extension/` | Prepify Capture Chrome extension (Manifest V3) |

## Data sources and terms

Glassdoor and AmbitionBox don't allow automated scraping, and neither offers a public API. Prepify doesn't crawl them from a server. The extension reads only the pages you ask for, in your own browser, and the data never leaves your machine. A public, multi-user version would need licensed data or other permitted sources.
