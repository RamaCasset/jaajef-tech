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

### Honest limit of the first version
Because the code runs in the browser, the server cannot re-run it. It refuses
solves that are impossibly fast and pays only once per quest, but a determined
person could still claim a pass they did not earn. The planned fix (V2) is a
server-side runner that re-runs the submitted code. Until then, quests are best
treated as practice and demo content, not as a prize-grade competition.

## Still to decide (TBC)
| Item | Placeholder used meanwhile |
|---|---|
| Level formula | 10 000 XP per level (`xp_per_level`) |
| Souk creator share | not set (`souk_creator_share_percent`) |
| Spelling of the 4th clan | stored as `buur_linguere`; display name set in the app |
| Payment provider | none: Kopeks are earned only in the first version |

## Next steps
1. Chat: communities, channels, messages (with live updates)
2. Projects imported from GitHub
3. Souk, then Jobs
4. Back-office for writing quests, tests and seasons
