# Product decisions

Decisions given by the project owner. Newest first. Open points are marked "to confirm with Marie".

## 7 November 2026

- Karma is removed. There will be no karma score anywhere.
- Country rank is removed.
- No ranked play and no seasons. The only competitive space is the Quest arena.
- Quest arena: the place where quests live and are done. A member sees every quest they have done and can choose to redo an earlier one. One new quest appears each day. Redoing a quest pays nothing more (rewards are paid once per quest, already how the database works): to confirm with Marie.
- Quest pool: 365 quests, one shown per day, visible to everyone. A new pool is created every year.
- Learning paths become a space to learn software engineering (coding, UI, UX, backend, AI and more). It links out to free programs such as freeCodeCamp; the platform does not host the lessons. Which programs, and how they are ordered: to confirm with Marie.
- Hosted repos: members can create a repository (a "depot") on the platform, import code from GitHub, show it, edit it in the browser the way they would in VS Code, and commit it back to GitHub if they want to.
- Onboarding is a how-to guide for using the platform: it shows the main screens and functions, and how to earn points and experience (XP, Kopeks, streaks, badges). Exact steps and wording: to confirm with Marie.
- The monthly challenge becomes an occasional virtual hackathon, individual or in groups. The whole project runs inside the platform. Sponsors fund it, and the prize payments are handled by a third party, not by the platform. Rules, judging and the entry flow: to confirm with Marie.
- The talent directory is open to every signed-in member (not to visitors). Members still choose to appear in it.

## Hosted repos: the agreed approach (not built yet)

GitHub stays the home of the code. The platform shows it and offers a browser editor on top. Built in three steps:
1. View code read-only, from public repositories (no extra GitHub permission).
2. Edit in the browser and commit back to GitHub, through a GitHub app where each member picks which repositories to allow, with permission limited to file changes, and the access kept on the server only.
3. Create a repository. First version: send the member to GitHub's new-repository page, then import it. Creating one directly from the platform needs checking against what GitHub allows.

The platform does not store members' code itself.

The code runner (E2B) is used only for quests today. The editor does not need it to edit and commit. Whether the editor can also run a project's code (the old "live demo / Run Sandbox" idea) is open: to confirm with Marie.

## What these decisions change in the existing build

- The badge "Teranga legendaire" is defined as "1 000 karma points". With karma gone it needs a new rule or removal: to confirm.
- The badge "Champion du Sahel" needs a ranking tier. With ranked play gone it needs a new rule or removal: to confirm.
- The database keeps a points leaderboard per season. It is unused if there are no seasons.
- The talent directory used to be browsable only by approved companies. It is now open to signed-in members (separate PR).
- Hosted repos are a large feature: a browser code editor, import from GitHub, creating repositories and committing back. It needs more GitHub permission than sign-in alone (the GitHub app settings must change), and a safe way to hold each member's GitHub access on the server, never in the browser. Where the code lives while a member edits it (our storage or only GitHub) is to decide before building.
