# Architecture (plain language)

## The idea
Marie's screens are the front of the shop. Supabase is the back room: it stores
everything, handles login and keeps chat live. We write only the rules that are
specific to jaajef.tech (XP, Kopeks, quests, the Souk).

## How a member's points work
1. A member does something rewarded (solves a quest, publishes a project...).
2. The **server** calls `grant_reward(member, xp, kopeks, reason, key)`.
3. In one all-or-nothing step it updates the member's XP, wallet and history.
4. The `key` makes it safe to retry: the same reward can never be paid twice.

The browser is never allowed to change XP or Kopeks. This is enforced by the
database itself, and the tests check it.

## What is public and what is private
| Data | Who can read it |
|---|---|
| Profile (name, bio, clan, XP, badges) | Everyone, even visitors |
| Wallet (Kopeks balance) and history | Only the member |
| Game settings (`game_config`) | Everyone |
| Public communities (name, description) | Everyone, even visitors |
| Private communities | Only their members |
| Channels, members and messages of a community | Only that community's members |
| Invite links | Nobody directly; the server checks them |

A member can edit only their own name, avatar, banner, bio, location,
username and "available to collaborate". Clan and level changes go through
`set_character()` and `set_onboarding_step()`.

## Sign-up
Every new account automatically gets a profile, a wallet and the welcome Kopeks.
The GitHub username is stored only when the login really came from GitHub, so
nobody can claim someone else's GitHub name by typing it in.

## Quests
1. A member opens a quest. The server starts a clock for that member.
2. The member codes in the browser. The browser runs the tests and can save
   progress so the member can resume later.
3. On submit, the browser reports how many tests passed. If all of them did,
   the server checks the time it measured itself, then pays the XP and Kopeks
   once through `grant_reward()`.
4. The member's streak goes up by one day (a missed day resets it to 1). Every
   7th day in a row pays a chest of 100 Kopeks, once per day at most.
5. Leaderboards (per quest, fastest first; per season, most points) show names
   and times only, never anyone's code.

Only published quests are visible. Quests with no tests, or still in draft,
cannot be started. Seven quests from Marie's screens are loaded: one is
complete (La Malédiction du Loop) and the other six are drafts waiting for
their statements and tests.

### Quests are lessons
Every quest exists to teach coding. Each one has:
- **A language:** Python, JavaScript, or HTML and CSS (for front-end quests,
  checked automatically in the browser).
- **A topic and a position,** so a clan's quests can be ordered from easy to hard.
- **Hints,** revealed one at a time. The server counts how many a member used,
  which supports the "quests without hints" goal. Hints are never public.
- **An explanation,** written as a short lesson ("why it failed, the clean
  solution, what to remember"). It stays locked until the member solves the quest.

The hints and the explanation for La Malédiction du Loop are a sample of a
finished lesson, written as a draft to be reviewed and edited.

### Honest limit of the first version
Because the code runs in the browser, the server cannot re-run it. It refuses
solves that are impossibly fast and pays only once per quest, but a determined
person could still claim a pass they did not earn. The planned fix (V2) is a
server-side runner that re-runs the submitted code. Until then, quests are best
treated as practice and demo content, not as a prize-grade competition.

## Chat
A community has an owner, optional moderators and members. It is public (anyone
can join in one click) or private (you need an invite link). Inside it, channels
come in three kinds: chat, announcement (only the owner and moderators can post)
and forum (a thread has a title, replies stay one level deep).

- Members can read and write only through the server's functions, never straight
  into the tables, so every rule below is checked on the server.
- Only people inside a community can read its channels, members and messages.
- Authors can edit and delete their own messages. Owners and moderators can
  delete any message (the text is wiped, the place stays so threads keep their
  shape). Nobody can edit someone else's message.
- Only the owner changes roles. Moderators can invite, create channels and remove
  plain members, but not the owner or other moderators.
- Invite links last 7 days and bring in up to 20 people by default.
- Limits against spam, all in `game_config`: 20 messages per minute per member,
  3 communities created per member, 30 channels per community, 4000 characters
  per message. These numbers are guesses and can be changed without code.
- Messages are sent out live (Supabase Realtime).
- Chat gives no XP or Kopeks, so it cannot be farmed.
- Not yet possible: editing a community's name, transferring ownership, banning
  (a removed person can rejoin a public community), private messages and files.

## Still to decide (TBC)
| Item | Placeholder used meanwhile |
|---|---|
| Level formula | 10 000 XP per level (`xp_per_level`) |
| Souk creator share | not set (`souk_creator_share_percent`) |
| Spelling of the 4th clan | stored as `buur_linguere`; display name set in the app |
| Payment provider | none: Kopeks are earned only in the first version |

## Next steps
1. Private messages and shared files
2. Projects imported from GitHub
3. Souk, then Jobs
4. Back-office for writing quests, tests, hints and seasons
5. Writing the real quest content (the largest job). Later, let community
   members propose quests, with an admin approving each one.
