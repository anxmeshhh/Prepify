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
python app.py                      # opens http://localhost:5000 in your browser
```

Google sign-in works out of the box: Prepify's client ID is built in.

### Use your own Google sign-in client (optional)

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and choose **Web application**.
2. Add `http://localhost:5000` as an authorised JavaScript origin.
3. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` (it overrides the built-in one), plus any long random `PREPIFY_SECRET` so sign-ins survive restarts. `.env` is git-ignored, and no client secret is needed. Then run `python app.py`.

### Load the extension (needed for pulling)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder. After an update, click the reload icon on the card.
3. In the same Chrome, sign in to Glassdoor and AmbitionBox once.

When you click a source box, the extension opens that site in a background tab and finds the company's interview page. It opens at most three pages per site, with no pagination or crawling. It reads the questions, answers and reviews, hands them to your Prepify tab and closes the background tab. You can also click **Save to Prepify** on any page you're viewing, or right-click selected text.

## Sources

| Source | How Prepify reads it | What you get |
| --- | --- | --- |
| Official careers page | Prepify server fetches the company's public careers or campus page (robots.txt respected, nothing stored). Known for major Indian recruiters; for other companies you paste the link once | Eligibility, selection process, test pattern: the ground truth |
| Glassdoor | Extension, in your own signed-in Chrome | Interview experiences, questions, answers |
| AmbitionBox | Extension | Experiences with rounds, questions, answers, tips |
| Indeed | Extension (same login as Glassdoor); tries the company page directly if search has no link | Interview experiences and questions |
| GeeksforGeeks | Extension: searches "<company> interview experience" and reads up to 4 articles | Round-by-round write-ups, questions, tips |
| Naukri Code360 | Extension: the company's interview-experience list, then up to 4 experiences | Round-by-round experiences with problems asked |
| PrepInsta | Extension: site search, then up to 4 company pages (interview questions, recruitment process) | Questions with answers, recruitment process |
| LeetCode Discuss | Extension: interview-experience posts mentioning the company | Candidate write-ups, coding questions |
| Reddit | Extension reads old.reddit.com search and up to 4 threads (no setup). If `REDDIT_CLIENT_ID` is set, the official API on the Prepify server is used instead | Threads with the original post and top comments |
| LinkedIn | Links only | LinkedIn doesn't allow automated reading, so Prepify only links to posts |

### Optional: Reddit official API

1. Go to https://www.reddit.com/prefs/apps, click **create another app** and choose **installed app**. Use `http://localhost:5000` as the redirect URI; it isn't used.
2. Copy the client ID, the short string under the app name, into `.env` as `REDDIT_CLIENT_ID=...`, then restart Prepify. No secret and no Reddit login are needed. Results go straight to your browser and the server stores nothing.

## Search understanding

Prepify reads a query the way a person would and shows what it understood as chips under the search bar (**Edit** fixes any of them):

| Piece | Examples |
| --- | --- |
| Company | aliases (`jp morgan` → JPMorgan Chase, `cts` → Cognizant, `infy` → Infosys), typos (`accenure` → Accenture), legal suffixes dropped (`Pvt Ltd`) |
| Role | `SDE 2` → SDE-2, `ASE`, `TCS Ninja`, `GenC Next`, `senior data scientist`, `for the data analyst role` |
| Level and experience | `fresher`, `off campus`, `intern`, `3 years experience`, `2 yoe` |
| Location and year | `bangalore` → Bengaluru, `gurgaon` → Gurugram, `2025` |
| Rounds | online assessment / NQT, aptitude, coding, technical, system design, machine coding, managerial, HR, behavioural, GD, case study |
| Topics | SQL, Java, React, Kafka... (about 80 skills); the dashboard then lists the pulled questions on those topics |

You can also write it explicitly: `company:"Target" role:"Data Analyst" interview questions`.

## Job description analysis

Click **Add job description** on the home page, the results page or the side panel. Paste the JD or upload it (PDF, DOCX or TXT), and optionally add your resume. Prepify analyses it on the server, sends the result back and keeps nothing; the result lives in your tab like everything else. Works in guest mode too.

The JD page has these tabs:

- **Overview:** role, seniority, experience, work mode, location, salary, education, academic cut-offs, bond, shifts, plus the responsibilities, requirements and nice-to-haves.
- **Skills:** every skill the JD asks for, marked required, nice to have or expected (DSA and OOP for engineering roles, SQL for data roles), with the JD line it came from and what to revise.
- **Likely rounds:** predicted from the role family, seniority and skills, each with the reason and what to focus on, next to the rounds candidates actually reported.
- **Prep plan:** skills ordered by what the JD stresses and what was actually asked, with a checklist of topics (progress saved in the tab), the company's reported questions and practice questions with LeetCode or GeeksforGeeks links.
- **Matching questions:** the pulled questions that touch the JD's skills, grouped by skill. Question cards everywhere get a *JD* tag and a *Matches your JD* filter.
- **Resume match:** the share of required skills your resume shows, what's missing, and talking points.
- **Questions to ask:** questions for the interviewer built from the JD, plus resume keywords.

The JD analysis is also the first section of the PDF.

## AI assist (optional)

With a Groq API key in `.env` (`GROQ_API_KEY=...`, then restart), signed-in users can turn on **AI assist**. The work is done by `openai/gpt-oss-120b` (set `PREPIFY_AI_MODEL` to change it). It stays off until the user reads what it sends and turns it on, and it can be turned off any time in the side panel.

- **Tidy pulled questions:** fixes messy scraped text, hides things that aren't questions, merges the same question asked in different words across sources, and tags each question by subject, round and difficulty. This runs automatically for new questions while AI assist is on, and **Show as pulled** brings back the original text.
- **Read any job description:** a deeper reading of pasted or uploaded JDs. It fills the same tabs as the standard reading and adds a *Worth checking* list (bond, shifts, missing salary and so on). Anything the AI leaves empty, and the round predictions when the JD states no process, come from the standard reading. If the AI is unavailable, the standard reading is used. Scanned PDFs and photos still need pasting, because there is no vision model on this provider.
- **Understand any search:** when the standard parser can't find the company or has to guess, the AI reads the search (typos, descriptions, unusual wording).

**Prompt injection screening:** scraped questions, JDs and searches are first checked by Llama Prompt Guard 2 (`meta-llama/llama-prompt-guard-2-22m`). Text that tries to give the AI instructions is never sent to it: a flagged question is kept as pulled, a flagged JD gets the standard reading, and a flagged search uses the standard parser.

The questions, JD and searches are sent to Groq's API and the results come straight back; the resume is never sent, and Prepify stores nothing. Each user gets `PREPIFY_AI_DAILY_LIMIT` AI requests a day (60 by default, counted in memory). Groq's free tier allows 8,000 tokens a minute for gpt-oss-120b, so questions go in batches of 40 and Prepify waits and retries when Groq asks it to. All AI code is in `ai.py`.

## Using results

- **Clean presentation:** site text is tidied before display and in the PDF. Leftover page clutter ("Helpful", "Read more", "Answer question") is removed, run-together steps become numbered lists, bullets become lists, very long text is split into paragraphs, and repeated paragraphs are dropped.
- **Practice links:** coding and SQL questions link to the matching LeetCode problem for common classics, otherwise to a LeetCode or GeeksforGeeks search.

- **Dashboard:** one box per source. Click a filled box to open that source's own page, or an empty box to pull it.
- **Source page:** tabs for *Experiences*, *Questions & answers*, *Discussions*, *Reviews* and *Source pages*, with filters by outcome or subject, a switcher between sources and **Back to results**. Browser back and forward work too.
- **Download PDF:** all sources from the dashboard, or one source from its page. The PDF is built in your browser.

## Sharing Prepify (Windows app)

Prepify's Google sign-in client ID is built into `app.py`, so the people you share it with don't need Google Cloud, a `.env` file or any setup.

**Build it (you, once per release):**

```
pip install -r requirements.txt pyinstaller
python build_exe.py
```

This makes `dist/Prepify-windows.zip` (about 32 MB) with `Prepify.exe`, the `extension` folder and `HOW-TO-USE.txt`. Share that zip. Your `.env` is not included, so your Groq key stays with you.

**What the people you share it with do:** unzip it and double-click `Prepify.exe`. A console window opens (closing it stops Prepify) and their browser opens Prepify at `http://localhost:5000`. Guest mode works straight away. To pull sources they sign in with their own Google account and load the extension once (`chrome://extensions` → Developer mode → Load unpacked → `extension`). For AI assist they put their own free Groq key in a `.env` file next to `Prepify.exe`. `HOW-TO-USE.txt` walks them through all of this.

**Things to know:**

- **Google sign-in for other people:** while the Google Cloud OAuth consent screen is in *Testing*, only accounts you add under *Test users* (up to 100) can sign in. To let anyone sign in, publish the app on the consent screen page. Prepify asks only for the basic sign-in scopes (name, email), which don't need Google's full app review; Google may still ask to verify the app's name and logo before showing them.
- **Port 5000 is fixed.** Google sign-in (`http://localhost:5000` is the authorised JavaScript origin) and the extension are both set up for it. If another program holds the port, Prepify says so. If Prepify is already running, starting it again just opens the browser.
- **Don't build your Groq key into the app.** Anything inside the `.exe` can be extracted and your allowance used by others. Each person adds their own key.
- **Windows SmartScreen** warns about unsigned apps ("More info" → "Run anyway"). Code-signing the `.exe` removes the warning.
- The `.exe` runs on Windows only. Build on a Mac with the same command for a Mac version.
- Running from source: `python app.py` now uses the waitress server and opens the browser. Set `PREPIFY_DEBUG=1` in `.env` for Flask's auto-reloading development server.

## Project layout

| Path | What it is |
| --- | --- |
| `app.py` | Flask routes: `/api/parse`, `/api/jd`, `/api/ai/*`, Google sign-in (`/api/auth/*`), official pages and Reddit; no database |
| `ai.py` | AI assist (Groq: gpt-oss-120b, screened by Prompt Guard 2): question tidying, JD reading and search reading, with the daily limit |
| `query_parser.py` | Understanding search queries: company, role, level, location, rounds, topics |
| `jd.py`, `skills.py` | Job description and resume analysis, and the skills list with revision topics and practice questions |
| `tests/` | `python -m pytest tests` |
| `templates/search.html`, `static/search.*`, `static/jd.js`, `static/ai.js` | Search home page, results pages, JD page, AI assist and in-tab session store |
| `extension/` | Prepify Capture Chrome extension (Manifest V3) |
| `build_exe.py`, `packaging/` | Builds the shareable Windows app (`dist/Prepify-windows.zip`) and its user guide |

## Data sources and terms

Glassdoor and AmbitionBox don't allow automated scraping, and neither offers a public API. Prepify doesn't crawl them from a server. The extension reads only the pages you ask for, in your own browser, and the data never leaves your machine. A public, multi-user version would need licensed data or other permitted sources.
