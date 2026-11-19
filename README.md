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
| `music.js` | Existing music module in this repository; the agreed product direction is to keep music as a separate ON KING MUSIC bot, so migration/removal must be planned and reviewed rather than silently deleting this module |
| `voice-presence.js` | Persistent voice-channel presence helpers |
| `package.json` | Node 20+ project metadata and static syntax-check script |

## Local static check

Requires Node.js 20 or later:

```sh
npm run check
```

This runs `node --check` on the four JavaScript source files. It does not start the Discord bot or log in to Discord.

## Configuration

Set credentials as environment variables in the host; never place their values in Git:

- `DISCORD_BOT_TOKEN`
- `DISCORD_SYNC_SECRET`
- `SUPABASE_URL` (the source has the ON KING project URL as a fallback)
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`
- `DASHBOARD_ORIGINS` (comma-separated exact website origins)
- `PORT` (provided by the hosting platform when applicable)

The Dashboard API runs in the same Node process as the Discord bot in the current implementation. Therefore, testing the live API currently requires starting that process, which also attempts Discord login. Keep live testing disabled until the owner explicitly approves it.

## Project notes

See [docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md) for implemented systems, agreed architecture, pending integration work, and the safety checklist.
