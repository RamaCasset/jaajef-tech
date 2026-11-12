# Draft content: what is here and what to decide

All of this is a first draft for Thursday night. Nothing is published: every row says `non` in the `published` column.

## What is in the folder
- `quests.csv` and `tests.csv`: 32 quests with hidden tests, three hints each and an explanation. The expected answers were computed by running a reference solution, and the JavaScript ones were checked again in Node.
  - Griot du Code: 13 quests (Python and JavaScript)
  - Saltigué: 8 Python quests (statistics, grouping and ranking)
  - Buur/Lingeer: 7 Python quests on security and privacy
  - Forgeron: 4 quests on web concepts (images without alt, hex to RGB, contrast ratio, layout by screen width). The page itself cannot be graded automatically today (see below).
- `paths.csv` and `steps.csv`: one learning path per clan: 6 lessons each, and 9 for Saltigué (3 SQL lessons, reading only). 24 of the 27 steps have a quest. Each lesson has an explanation, examples, a summary and a practice line (about 290 words on average, 7,800 in total). Steps with a quest finish when the quest is solved.
- Everything is French, short and meant to be rewritten in your voice.

## To review on Thursday
- Wording, tone and the Senegalese touches (names, places, food).
- Rewards: XP and Kopeks here are placeholders (100 to 150 XP, 20 to 30 Kopeks).
- Difficulty order inside each clan (`position`).
- Whether a quest that needs a list or an object as input feels natural for beginners.

## Other languages to consider
Today the runner grades functions written in Python or JavaScript: one input in, one value out.
- TypeScript: easy to add (strip the types, run as JavaScript). Good for the Griot du Code.
- SQL: a very good fit for Saltigué (data). The sandbox would load a small table and compare the rows returned. Needs a runner extension.
- HTML and CSS (Forgeron): cannot be graded by comparing values. Options: check the page structure with simple rules ("has one h1", "images have alt"), or review by another member. Needs a decision.
- Bash or shell: good for Buur/Lingeer but riskier in a sandbox; later.
- Go, Rust, Java: possible but each language adds setup and cost; not before launch.
Recommendation: launch with Python and JavaScript, add TypeScript and SQL next.
