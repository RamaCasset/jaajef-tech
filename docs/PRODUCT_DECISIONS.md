# Product decisions

Decisions given by the project owner. Newest first. Open points are marked "to confirm with Marie".

## 7 November 2026

- Karma is removed. There will be no karma score anywhere.
- Country rank is removed.
- No ranked play and no seasons. The only competitive space is the Quest arena.
- Quest arena: the place where quests live and are done. A member sees every quest they have done and can choose to redo an earlier one. One new quest appears each day. Redoing a quest pays nothing more (confirmed). Members can open and do quests from days they missed, but those pay no XP or Kopeks: only the quest of the day pays, on its day. Today the database pays once per quest on any day, so this rule is a change to build later.
- Quest pool: 365 quests, one shown per day, visible to everyone. A new pool is created every year.
- Learning paths become a space to learn software engineering (coding, UI, UX, backend, AI and more). It links out to free programs such as freeCodeCamp; the platform does not host the lessons. Which programs, and how they are ordered: to confirm with Marie.
- Hosted repos: members can create a repository (a "depot") on the platform, import code from GitHub, show it, edit it in the browser the way they would in VS Code, and commit it back to GitHub if they want to.
- Onboarding is a how-to guide for using the platform: it shows the main screens and functions, and how to earn points and experience (XP, Kopeks, streaks, badges). Exact steps and wording: to confirm with Marie.
- The monthly challenge becomes an occasional virtual hackathon, individual or in groups. The whole project runs inside the platform. Sponsors fund it, and the prize payments are handled by a third party, not by the platform. Entering works like communities: one member enrols, then adds the other members of the team. Sponsors are only made aware (informed, no special role). At the end each team gives a live demo in the platform to be judged. Each hackathon is an event that staff create when sponsors are found. Judges, dates, phases, team size limits and sponsors are settings of the event, not fixed in the platform, and nothing needs to be decided now (decided 7 November).
- The talent directory is open to every signed-in member (not to visitors). Members still choose to appear in it.

## Hosted repos: the agreed approach (not built yet)

GitHub stays the home of the code. The platform shows it and offers a browser editor on top. Built in three steps:
1. View code read-only, from public repositories (no extra GitHub permission).
2. Edit in the browser and commit back to GitHub, through a GitHub app where each member picks which repositories to allow, with permission limited to file changes, and the access kept on the server only.
3. Create a repository. First version: send the member to GitHub's new-repository page, then import it. Creating one directly from the platform needs checking against what GitHub allows.

The platform does not store members' code itself.

Editor layout (decided): a list of files on the left, tabs on top, the code in the middle, and a box at the bottom to describe the change and commit it. The editor itself is Monaco, the open-source editor that powers VS Code. Marie can restyle the screen around it. Reference for the feel: DartPad (the online Dart editor), with code on one side and a console and preview panel on the other, so the editor also gets an output panel beside the code (decided 7 November).

The code runner (E2B) is used only for quests today. The editor does not need it to edit and commit. The editor will also get a Run button that runs a project's code in E2B (decided 7 November). The hackathon live demo depends on it. Planned limits to confirm: time per run, runs per day, no internet at first, signed-in members only, command-line output first and web previews later.

## What these decisions change in the existing build

- The badge "Teranga legendaire" is defined as "1 000 karma points". With karma gone it needs a new rule or removal: to confirm.
- The badge "Champion du Sahel" needs a ranking tier. With ranked play gone it needs a new rule or removal: to confirm.
- The database keeps a points leaderboard per season. It is unused if there are no seasons.
- The talent directory used to be browsable only by approved companies. It is now open to signed-in members (separate PR).
- Hosted repos are a large feature: a browser code editor, import from GitHub, creating repositories and committing back. It needs more GitHub permission than sign-in alone (the GitHub app settings must change), and a safe way to hold each member's GitHub access on the server, never in the browser. Where the code lives while a member edits it (our storage or only GitHub) is to decide before building.

## Onboarding guide (built as a static page at /guide)
Assumptions to confirm with Marie:
- The guide is one page with nine short sections (Cité, quests, points, Souk, projects, communities and messages, jobs and talent directory, blog, rules), reached from a "Guide" link in the top bar.
- It gives no point values; each quest shows its own reward. Real numbers can be added once the bonus values are decided.
- There is no first-visit pop-up or step-by-step tour yet. Marie decides whether a new member should be sent to it after sign-up.
- The wording is a first draft in French, to be rewritten with Marie.

## Decisions of 8 November
- Languages: the site is available in French and English, chosen by the member. Names that are not French (Griot du Code, Saltigué, Ndongo, Bagne, Borom Xam-Xam, Kopeks, Teranga, Souk) are never translated.
- Content in two languages: official content written by the team (quests, badge names, team shop items) is stored in both languages. Member-written content (blog, messages, project text, creator shop items) stays in the language it was written in. Database change to come before the quests are written.
- Badges (agreed): "Champion du Sahel" is earned by finishing in the top 10 of the monthly leaderboard (XP earned in the month). "Teranga legendaire" is earned by receiving 100 stars and likes in total on a member's projects and articles. Both are still to build.
- Karma and Rank are removed from the profile. They will not be built.
- Voice rooms, live stream and "Telegram files" are left out for now. File attachments in chat remain on the list, later.
- Repositories stay on GitHub. The "Nouveau dépôt" form sends the member to GitHub's new-repository page with name, description and visibility filled in, then imports it.
- Project demos: the owner adds a demo link and the project shows a "Voir la démo" button. No running of projects on the platform in the first version.
- Hackathon: an admin form (title, dates, rules, prizes, team size) used whenever a hackathon is organised. Nothing is preset.
- Editor commits show as made by the GitHub app ("Saved from jaajef.tech by @username"). Accepted.
- Bonus values and payments (PayDunya) are placeholders until the end.
- The 365 quests are written by Claude, in batches, each tested with the code runner, after the main features.
- Project room: a private room for the owner and the collaborators of a project (a hidden community linked to the project, created by the owner with one button). Public talk about a project stays in its comments. Assumption to confirm with Marie: the room is a button on the project page that opens the community screen, not a tab, and it also shows in the member's list of communities.
