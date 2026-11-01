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
3. Quests (in-browser tests) with ranking
4. Souk, then Jobs
