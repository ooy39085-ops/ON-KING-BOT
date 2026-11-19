# ON KING BOT

Discord bot for ON KING COMMUNITY.

## Project safety

- Work on feature branches first; do not overwrite the default branch without review.
- Keep the bot offline during development. Do not run `node index.js`, Hostrix Start/Restart, or any command that triggers Discord login unless the project owner explicitly approves bringing the bot online.
- Never commit Discord tokens, Supabase secrets, sync secrets, or other credentials. Configure secrets only in the hosting provider's environment variables.
- Preserve existing JSON data files and Supabase schema/policies. Do not rebuild or reset the database as part of bot work.

## Current source layout

| File | Purpose |
| --- | --- |
| `index.js` | Main Discord bot, slash commands, Sweet Match, ON KING CUPID, member sync, voice-presence restore, Dashboard API startup |
| `dashboard-api.js` | HTTP API for the website's Owner/Admin Bot Dashboard |
| `cupid.js` | ON KING CUPID marriage/divorce requests, confirmation buttons, countdowns, image cards, and history |
| `card-renderer.js` | Generates customizable PNG Couple/Divorce cards with Discord avatars using `sharp` |
| `voice-presence.js` | Persistent voice-channel presence helpers |
| `package.json` | Node 20+ project metadata and static syntax-check script |

## Local static check

Requires Node.js 20 or later:

```sh
npm run check
```

This runs `node --check` on the five JavaScript source files and verifies the CUPID module exports. It does not start the Discord bot or log in to Discord.

## Configuration

Set credentials as environment variables in the host; never place their values in Git:

- `DISCORD_BOT_TOKEN`
- `DISCORD_SYNC_SECRET`
- `SUPABASE_URL` (the source has the ON KING project URL as a fallback)
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`
- `DASHBOARD_ORIGINS` (comma-separated exact website origins)
- `PORT` (provided by the hosting platform when applicable)
- `ONKING_CUPID_CARD_TEMPLATE_BASE_URL` (optional; defaults to `https://onking1510u.netlify.app/assets/cupid`)

The Dashboard API runs in the same Node process as the Discord bot in the current implementation. Therefore, testing the live API currently requires starting that process, which also attempts Discord login. Keep live testing disabled until the owner explicitly approves it.

## Project notes

See [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) for implemented systems, agreed architecture, pending integration work, and the safety checklist.

## Owner-only CUPID Card Studio

- The website editor calls `GET /api/card-guilds`, `GET /api/card-settings`, and `POST /api/card-settings`.
- The browser sends the signed-in Supabase access token and a Discord OAuth access token obtained through the linked Discord identity with `identify guilds` scopes.
- The API validates the Supabase user, checks that the Discord identity is linked to that same Supabase account, and verifies the Discord API's `owner === true` value for the selected guild.
- A guild is listed only when the current bot is already a member of it. Website Owner/Admin roles do not grant card-edit permission.
- Per-guild card settings are stored in `on-king-card-settings.json`. Preserve this runtime file on every Hostrix update and keep it out of Git.
- The editor is served by the website page `guild-cards.html`; the API CORS allowlist must include the exact production website origin.
- Static checks do not prove Discord OAuth token persistence, actual owner authorization, image generation, or live Discord delivery. Those require a controlled runtime test after deployment approval.
The website package includes the approved card artwork at `assets/cupid/on-king-couple-card.png` and `assets/cupid/on-king-divorce-card.png`. Deploy those files before testing the bot's card renderer, or set the template base URL to the deployed site's matching `assets/cupid` directory.
