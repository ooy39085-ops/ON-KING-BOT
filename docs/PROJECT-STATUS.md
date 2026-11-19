# ON KING BOT — Project Status & Roadmap

Last reviewed: 2026-11-19  
Repository: `ooy39085-ops/ON-KING-BOT`  
Working branch: `feature/owner-only-cupid-card-editor-20261119`

This document records the agreed scope so future code changes preserve existing work and do not silently change the architecture.

## 1. Existing systems found in the current source

These are source-level observations, not claims that a live bot is currently running:

- **Main Discord bot** — `index.js`, using discord.js v14 and Node.js 20+.
- **Sweet Match** — setup and panel slash commands, match creation/cleanup, temporary voice rooms, and active-match handling.
- **ON KING CUPID** — `/marriage @member` and `/breakup` send requests to the configured request rooms. Only the recipient can confirm/decline. Requests expire after one hour with a visible countdown; accepted marriages create an image card and accepted divorces update the old card and post a divorce image. `/checkcouple` also returns the image card. Cupid data is stored separately in `on-king-cupid-data.json`. Configure it with `/cupid-setup` and four different text channels: marriage request, marriage announcement, divorce request, and divorce announcement.
- **CUPID Card Studio** — website page `guild-cards.html` edits per-server Couple/Divorce card text and colors. Approved image templates are served from the website's `assets/cupid/` directory; Hostrix uses `ONKING_CUPID_CARD_TEMPLATE_BASE_URL` (default `https://onking1510u.netlify.app/assets/cupid`). API validates the Supabase session, verifies the linked Discord identity, then checks Discord's actual `owner === true` flag and confirms the bot is in that guild. Website Owner/Admin roles alone do not grant access. Settings persist in `on-king-card-settings.json` and must be preserved on Hostrix.
- **Persistent voice presence** — `voice-presence.js` is loaded by the main bot; `/voice-room` has Thai localization `/ตั้งห้องออน`, requires Manage Server permission, and accepts a selected voice channel. Startup calls the voice-presence restore helper.
- **Website/Supabase member sync** — source includes member add/update/remove handling and bulk sync logic. The existing ON KING Supabase project and its schema/policies are to be preserved.
- **Owner/Admin Dashboard API** — `dashboard-api.js` exposes `/health`, `/api/dashboard`, `/api/channels`, `/api/presence`, and `/api/message`. These routes validate a Supabase bearer session and an Owner/Admin role in `user_roles`.
- **Server-owner Card Studio API** — exposes `/api/card-guilds`, `/api/card-settings` (GET/POST), requiring the linked Discord account to own the guild according to Discord API.
- **Music playback** — explicitly removed from ON KING BOT at the owner’s request. Music slash commands, playback handler, `music.js`, music-only folders, and `play-dl` dependency are removed. `@discordjs/voice` remains because permanent voice presence and Sweet Match need it.

## 2. Agreed architecture and permissions

### Main ON KING BOT
- Retain Sweet Match.
- Retain ON KING CUPID with `/marriage @member`, `/breakup`, one-hour confirmation countdowns, and separate request/announcement channels.
- Retain website/Supabase member synchronization.
- Retain persistent voice-room presence.
- The voice-room selection is administrator-controlled; ordinary members must not be able to change it.
- Preserve current user data and configuration JSON files.

### Music removal
- No music playback is part of ON KING BOT. Do not reintroduce music commands or playback dependencies unless the owner explicitly asks.
- Migration must be staged so the existing main bot does not lose working functionality.

### Website Bot Center
- Public/member-facing Bot Center includes the **“เพิ่ม ON KING BOT เข้าไปในเซิร์ฟเวอร์”** invite flow.
- Owner/Admin dashboard is restricted server-side to website Owner/Admin roles.
- Planned/visible dashboard capabilities include bot status, guild/member counts, status/activity adjustment, channel selection for announcements, and sending Discord messages.
- Website role permissions and Discord roles are separate. Discord roles must not grant or override website Owner/Admin access.
- Website and API use the existing ON KING Supabase project; do not rebuild the database or change RLS/policies without a separate explicit approval.

## 3. Integration work still to verify

1. **Production website origin (verified from owner)** — `https://onking1510u.netlify.app` (the member page is `/member.html`). The API now allows this exact origin by default; additional origins can be added through comma-separated `DASHBOARD_ORIGINS`. The website Card Studio requires Discord OAuth scopes `identify guilds`. No wildcard CORS is used.
2. **Host/API address (not yet live-verified)** — the website config currently points to `https://onking-bot.hostrix.website`. Confirm that Hostrix routes this domain to the Node API and maps its assigned port correctly; the website URL alone cannot prove API routing.
3. **Website application ID** — configure the Discord Application ID in the website only after verifying the correct application. The current website config has `botClientId` blank. Never put the bot token in frontend code.
4. **Authorization** — test Owner, Admin, and ordinary-member denial when live testing is approved. Keep the API's server-side Supabase session and `user_roles` checks.
5. **Discord permissions** — verify bot permissions and selected guild/channel behavior using a controlled test after approval.
6. **API resilience** — review rate limiting, request-size handling, readiness behavior, and useful error responses before exposing the API publicly.
7. **Music removal** — verify no music command registrations, playback handlers, music module, or `play-dl` dependency remain.
8. **Data safety** — confirm backup/restore procedures for Sweet Match, Cupid, voice-presence, and `on-king-card-settings.json` before any deployment that changes persistence.

## 4. CI / static verification

GitHub Actions runs `npm run check` on pushes and pull requests. This checks JavaScript syntax only; it does not install or run the bot, connect to Discord, contact Supabase, or prove Hostrix routing.

Run locally:

```sh
npm run check
```

## 5. Offline development and release checklist

- [ ] Keep the bot offline during code review and static checks.
- [ ] Never run `node index.js` or Hostrix Start/Restart without explicit owner approval.
- [ ] Never commit secrets or paste credentials into chat.
- [ ] Review diffs before replacing any existing source file.
- [ ] Preserve existing JSON data including `on-king-card-settings.json` and Supabase schema/RLS/policies.
- [ ] Verify CI syntax checks.
- [ ] Verify Hostrix environment-variable names and startup configuration without starting the process.
- [ ] Obtain explicit owner approval before the first live start/API test.
- [ ] After approval, test API health, Owner/Admin access, ordinary-member denial, channel list, presence update, and message sending.
- [ ] Only merge to the default branch after review and a successful test plan.

## 6. Important current limitation

The production website origin `https://onking1510u.netlify.app` is included in the API's exact CORS allowlist. The API domain and Hostrix routing still require live verification. The current Dashboard API is started by `startDashboardApi(client)` inside `index.js`, immediately before `client.login(token)`. This means starting the current process for a live API test also attempts to log the bot in to Discord. There is not yet a verified independent API-only mode. Do not start it merely to test `/health`; design and review an isolated API mode first, or wait for explicit approval to bring the bot online.

## 7. CUPID Card Studio implementation status (feature branch)

- [x] Add PNG card renderer with member avatars, names, relationship date, and guild-specific theme values.
- [x] Add API endpoints for listing owner-managed bot guilds and reading/saving per-guild card settings.
- [x] Enforce actual Discord guild owner status server-side; do not trust client-side role labels.
- [x] Add card renderer to static JavaScript syntax checks.
- [ ] Run GitHub Actions and review the pull request.
- [ ] Configure Hostrix CORS for the exact website origin and preserve the new JSON settings file.
- [ ] Verify Discord OAuth `identify guilds` linking, owner/non-owner denial, PNG rendering, and Discord message updates in a controlled test.
- [ ] Deploy/Restart Hostrix and confirm live health only after the owner-approved deployment window.