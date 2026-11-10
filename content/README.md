# Adding quests and lessons from a spreadsheet

Write the content in a spreadsheet (Google Sheets or Excel), one tab per file below, then turn it into one SQL file.

## The four tabs

Copy the examples in `content/templates/`. The first row of each tab is the column names: keep them exactly.

**quests**: one row per quest.
- `slug`: short name for the address, lower case letters, digits and dashes (example: `somme-des-pairs`).
- `clan`: `griot_du_code`, `forgeron`, `saltigue` or `buur_linguere`.
- `mastery`: `ndongo`, `bagne` or `borom_xam_xam`.
- `language`: `python` or `javascript` (graded automatically), or `html_css` (not graded automatically yet).
- `minutes`: 1 to 10. `xp` and `kopeks`: the rewards.
- `entry_point`: the name of the function the player writes. Required for python and javascript.
- `starter_code`: what the editor shows at the start.
- `position`: order inside the clan, 1 first (optional).
- `hint1`, `hint2`, `hint3`: hints shown one at a time (optional). `explanation`: shown after the quest is solved.
- `published`: `oui` to show it to members. Leave empty while it is being reviewed.

**tests**: the hidden checks. One row per check.
- `quest`: the quest slug. `name`: a short name.
- `input`: what the function receives, written as JSON. A list is `[1, 2, 3]`, text is `"abc"` in double quotes, a number is `5`.
- `expected`: what the function must return, also JSON. Python `None` and JavaScript `null` are both `null`.
- The function gets one input only. If it needs two values, use a list or an object (`{"a": 1, "b": 2}`).

**paths**: one row per learning path: `slug`, `clan`, `title`, `summary`, `position`, `published`.

**steps**: one row per lesson: `path` (the path slug), `position` (1, 2, 3...), `title`, `lesson` (text, Markdown allowed), `mastery`, `minutes`, `quest` (a quest slug if the step is finished by solving that quest, otherwise empty).

## Turning it into SQL

1. In the spreadsheet, download each tab as CSV and name the files `quests.csv`, `tests.csv`, `paths.csv`, `steps.csv` in one folder. A tab you are not using can be left out.
2. Ask Claude to run: `node tools/import-content.mjs <folder>`. It writes `import.sql` in that folder.
3. If something is wrong, it lists each problem with the file and line and writes nothing. Fix the sheet and run again.
4. Open `import.sql`, copy it into the Supabase SQL Editor and run it.

Running it again updates what exists (matched by slug) and removes nothing else. Member progress is never touched. Quests and paths arrive unpublished unless `published` says `oui`.
