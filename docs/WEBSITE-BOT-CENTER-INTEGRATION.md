# Website Bot Center integration — 2026-11-19

## Files
- Website package: `ON-KING-WEBSITE-BOT-CENTER-CONNECTED-PREP-2026-11-19.zip`
- Website pages: public `bot-center.html`; private `admin/bot.html`
- Browser client: `js/bot-dashboard.js`
- Public config: `config.js`
- Bot API: `dashboard-api.js`

## Contract corrections
The browser dashboard and API previously disagreed about several fields. The current API now returns:
- `actorRole` at the top level.
- `bot.online` and `bot.status`.
- A human-readable `message` after presence and message actions.

The browser client now sends `guildId` with `POST /api/message`, uses lowercase activity types, and displays API/CORS errors clearly.

## Website configuration
The prepared website config uses the known Hostrix public domain:
`https://onking-bot.hostrix.website`

This is a configured address, not proof that Hostrix currently routes requests to the Node API. The live `/health` route remains unverified while the Discord bot process is kept offline.

## Required host configuration
Set `DASHBOARD_ORIGINS` on Hostrix to the exact production website origin, with no path and no trailing slash. Example format:
`https://your-production-site.netlify.app`

Do not use wildcard CORS. The production website origin is not available in the retrieved project context, so it must be copied from the actual deployed site before the browser connection can pass CORS.

Keep existing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`), `DISCORD_SYNC_SECRET`, and bot token values private in Hostrix. Never commit their values or put them in website config.

## Discord invite
The public invite button still requires the actual Discord Application ID in `botClientId`. The ID was not found in the available project files/context; do not guess it and never use the bot token in its place.

## Live verification gate
The current API server is started inside the bot's Node process. Starting it also triggers Discord login. Therefore:
- Static syntax/ZIP checks can be done with the bot offline.
- Live `/health`, guild/channel reads, presence changes, and message sending require the process to be started.
- Do not start/restart Hostrix or run `node index.js` until the owner separately approves bringing the bot online.
- Do not change Supabase schema, RLS policies, or stored data for this integration.
