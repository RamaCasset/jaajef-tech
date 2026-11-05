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
| Private communities that are listed | Name, description and member count: everyone. Inside: members only |
| Private communities that are hidden | Only their members |
| Join requests | The requester, and the community's owner and moderators |
| Channels, members and messages of a community | Only that community's members |
| Invite links | Nobody directly; the server checks them |
| Private conversations and messages | Only the two people in them |
| Files sent in private messages | Only the two people, once attached to a message |
| Who you blocked | Only you |
| Projects confirmed on GitHub | Everyone, even visitors (unless the owner hides it) |
| Projects not yet confirmed | Only their owner |
| Staff roles | You see your own; admins see all |
| Audit log of staff actions | Admins only |

The clan and mastery are chosen once during onboarding and cannot be changed
afterwards (repeating the same choice is harmless). A member can edit only their own name, avatar, banner, bio, location,
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

Every quest takes at most 10 minutes. Monthly big challenges are recorded as
to be confirmed (solo or teams, length, reward).

### Honest limit of the first version
Because the code runs in the browser, the server cannot re-run it. It refuses
solves that are impossibly fast and pays only once per quest, but a determined
person could still claim a pass they did not earn. The planned fix (V2) is a
server-side runner that re-runs the submitted code. Until then, quests are best
treated as practice and demo content, not as a prize-grade competition.

## Chat
A community has an owner, optional moderators and members. It is public (anyone
can join in one click) or private. A private community is either listed (everyone sees its name and
description and can ask to join) or hidden (invite link only). Inside it, channels
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
- Ask to join: a person sends a request with an optional short message to a
  listed private community. The owner or a moderator approves or declines. Limits:
  10 pending requests per person, and 7 days to wait after a decline. There are no
  notifications yet: the app reads the pending requests.
- Limits against spam, all in `game_config`: 20 messages per minute per member,
  3 communities created per member, 30 channels per community, 4000 characters
  per message. These numbers are guesses and can be changed without code.
- Messages are sent out live (Supabase Realtime).
- Chat gives no XP or Kopeks, so it cannot be farmed.
- Not yet possible: editing a community's name, transferring ownership, banning
  (a removed person can rejoin a public community) and files in community channels.

## Private messages and files
- There is one private conversation per pair of members, whoever starts it.
  Only those two can read it. Everything is written through server functions.
- You can edit and delete only your own messages. Deleting wipes the text and
  detaches the file, so the other person loses access to it.
- Each conversation has an unread count per person and a preview for the inbox.
- Blocking works both ways: nobody can start or continue a conversation across a
  block, and only the person who blocked can see the block.
- One file per message: images, PDF, text, zip, up to 10 MB. The file goes into
  the private Storage bucket `dm-files`, in a folder named after the sender's id.
  The server checks the folder, that the file really exists, its type and its
  size when the message is sent. Browsers cannot overwrite or delete files.
- Limits against spam (in `game_config`): 20 messages per minute, 20 new
  conversations per day, 4000 characters per message.
- Known limit: a deleted message's file stays in Storage (nobody else can open
  it) until a clean-up job is added.
- Not yet possible: group conversations, several files per message, message
  search.

## Projects from GitHub
- A member lists a repository by pasting its link, with a title, a short summary
  and up to 8 tags. Limit: 30 projects per member.
- The repository must be under the member's own GitHub name. That name comes only
  from a verified GitHub sign-in and cannot be edited. Members who signed up by
  email must connect GitHub first.
- A new project is pending: only its owner sees it. It becomes public after the
  server asks GitHub and confirms the repository exists and belongs to that name.
  If a later check fails (deleted, renamed, moved), it is hidden again.
- Description, language and stars come from GitHub and are written only by the
  server. Members cannot change them.
- The first confirmation of a repository pays a one-time XP reward (placeholder
  50 XP, TBC). The reward belongs to the repository, so deleting and listing it
  again pays nothing more.
- The GitHub checker is a small Supabase Edge Function (`supabase/functions/github-sync`)
  that runs every hour. It asks GitHub about each unchecked project and sends the
  answer to the database. It hides a project only when GitHub says the repository
  does not exist, is private or is blocked. A network error or a rate limit never
  hides anything: the project waits for the next run. Setup guide:
  `docs/GITHUB_CHECKER_SETUP.md`.
- Still to build: project stars from other members, and search. Organization
  repositories are not supported yet.

- Still to build: the small server program that asks GitHub (it uses
  `projects_to_sync` and `record_github_sync`) and search. Organization repositories are not supported yet.



### Stars, comments and ask to collaborate
- Stars: a signed-in member stars a listed project (once; tapping again changes
  nothing). The count is public. Who starred is private, even to the owner. You
  cannot star your own project. Stars pay no reward, so there is nothing to
  farm. These are separate from GitHub's own star count.
- Comments: on listed projects only, up to 1000 characters, 20 per hour per
  member. Everyone can read them. The author edits or deletes their own; the
  project owner can delete any comment on their project.
- Ask to collaborate: a short message (up to 500 characters) to the owner.
  Allowed only when the owner has "available to collaborate" switched on in
  their profile. One waiting request per member per project, at most 10 waiting
  per member and 20 per project, and a 7-day wait after a decline. The owner
  accepts or declines; accepting adds the person to a public collaborator list
  (at most 10 per project). A collaborator can leave, and the owner can remove
  anyone. Collaborators get no extra rights yet: the list is for display.
- Only the requester and the owner can see a request.
- A suspended member cannot comment or ask to collaborate, and a project hidden
  by staff shows nothing and accepts nothing.

## Souk (shop)
- Three kinds of items: themes, avatar frames and status badges. Each has a
  name, a price in Kopeks and a "look" (colours, label) that the app reads.
- The shop is public. What a member owns is private. What a member wears (one
  item per kind) is public, so it shows on their profile.
- Buying goes through the same safe path as every other Kopek movement: it
  cannot spend more than the balance, cannot charge twice for the same item,
  and appears in the member's Kopek history. Purchases are final (no refunds in
  the first version). Items are owned for good.
- An item taken off sale stays with the people who already own it, and they can
  still wear it.
- Only the server adds or changes items for now. The six items in the database
  are placeholders until Marie's designs are ready.
- Not built yet: creator submissions, admin review, and the creator share
  (`souk_creator_share_percent` is still undecided).


### Ratings and theme of the week
A member who owns an item can rate it from 1 to 5 stars, change the rating, or
take it back. Only owners can rate (the database ties a rating to ownership).
Each item shows its average and number of ratings; who rated what is private.
`souk_shop()` lists the shop with averages, whether the viewer owns each item,
the viewer's own rating, and sorting (new, price, best rated).

An admin can pick one item to feature for a week (weeks start on Monday, UTC),
up to a year ahead. If no item is picked, or the picked item is taken off sale,
the shop features the most recently added item on sale. Staff can see the
coming weeks. Picking and clearing are written to the audit log, once per real
change. No Kopeks move and no prices change.

## Staff (admin and moderator)
- Staff are normal member accounts that carry a role, kept in a private table.
  There is no separate kind of account. A separate back-office web address can
  be added for convenience, but the real protection is the role in the database:
  a link alone protects nothing.
- Two roles: admin (everything) and moderator (platform-wide moderation, reports
  to come). These are separate from the owner and moderator roles inside a
  community.
- Only the server can create an admin (from the Supabase SQL Editor with
  `make_admin`). Admins can name and remove moderators but cannot create,
  change or remove other admins. The last admin can never be removed.
- Every staff action is written to a log that nobody can edit or delete, not
  even the database owner. Only admins can read it. Members cannot see who is
  staff.
- Recommended: turn on two-factor sign-in for every staff account in Supabase.
- Still to build: quest back-office (including auto-generated quests
  waiting for approval and quests submitted by admins), Souk and job review,
  and feature on/off switches.

## Reports and moderation
- Any signed-in member can report a community message, a private message they
  are part of, a project comment, a listed project, or a member. Nobody can report their own
  content or something they cannot see. At most 10 reports per member per day.
- Each report keeps a copy of what was reported, so the evidence stays even if
  the author edits or deletes it. Private messages are only ever seen by staff
  through a report about them, never by browsing.
- Staff queue: dismiss, remove the content, warn the member, or suspend the
  member. One decision closes every open report about the same thing.
- Suspension: moderators up to 7 days, admins up to 365 days. A suspended
  member can still read and delete their own messages but cannot post, edit,
  send private messages, list projects, create communities or start
  conversations. It ends by itself; only an admin can lift it early.
- Nobody can sanction an admin through a report. Only an admin can sanction a
  moderator.
- A project hidden by staff cannot be brought back by its owner; only an admin
  restores it.
- Every decision is written to the audit log.
- Suspended members are also blocked from join requests, project comments and
  collaboration requests. Project comments can be reported, and staff can
  remove them.

## Badges
- Each badge has a rule: what is counted and how many. The rules are in the table
  `badge_rules` and can be changed without code.
- Progress is tracked as members act (for example 42 out of 100). A badge unlocks
  when the goal is reached. Progress never goes down, and an unlocked badge is
  never taken back. Badges give no XP or Kopeks.
- Three badges are automatic: Gardien du Baobab (quests solved), L'Architecte
  (projects confirmed on GitHub) and Maitre Griot (contributions).
- The other four are manual for now, awarded by the server: Champion du Sahel
  (needs a ranking tier), Oeil du Saltigue (needs Data and AI challenges), Sceau
  de Linguere (needs security audits) and Teranga legendaire (needs a karma score).
- What counts as a contribution is TO BE CONFIRMED. For now: a forum thread or
  reply, not deleted, in a community with at least 3 members. The minimum stops
  anyone from farming the badge in their own empty community.
- Members cannot award themselves badges or change the rules. Everyone can read
  badges and progress, so profiles can show them.

## Still to decide (TBC)
| Item | Placeholder used meanwhile |
|---|---|
| Level formula | 10 000 XP per level (`xp_per_level`) |
| Souk creator share | not set (`souk_creator_share_percent`) |
| Spelling of the 4th clan | stored as `buur_linguere`; display name set in the app |
| What counts as a contribution (Maitre Griot) | Forum threads and replies in communities of 3 or more members |
| The four manual badges | Awarded by hand until their rules exist |
| Payment provider | none: Kopeks are earned only in the first version |
| XP for a listed project | 50 XP (`project_publish_xp`) |
| How mastery ranks relate to clans | Both kept for now; relation open |
| Monthly big challenges | Not designed: solo or teams, length, and reward (XP, Kopeks or a badge) all TBC |

## Next steps
1. Souk, then Jobs
2. Back-office for writing quests, tests, hints and seasons
3. Writing the real quest content (the largest job). Later, let community

1. The GitHub checker program for projects
2. Souk creator submissions and review, then Jobs
3. Back-office for writing quests, tests, hints and seasons
4. Writing the real quest content (the largest job). Later, let community
   members propose quests, with an admin approving each one.
