# ON KING MUSIC MultiBot (6 instances)

This folder contains six independent Discord music-bot instances for one hosting server.
Each instance has its own Discord token, process, queue, voice connection and
`on-king-music-config.json` because each instance runs from its own folder.

## Important
- This is separate from the existing ON KING BOT. Do not replace the root `index.js`,
  root `package.json`, Sweet Match data, CUPID data, or voice-presence files.
- Create six separate Discord applications/bots and invite all six to ON KING COMMUNITY.
- Never commit bot tokens to GitHub or paste them into source files.
- Use Node.js 20 or newer.
- YouTube links must be accessible and permitted for audio playback; availability can change.

## Environment variables
Set these six secrets in the hosting panel's environment/startup variables:

- `ONKING_MUSIC_01_TOKEN`
- `ONKING_MUSIC_02_TOKEN`
- `ONKING_MUSIC_03_TOKEN`
- `ONKING_MUSIC_04_TOKEN`
- `ONKING_MUSIC_05_TOKEN`
- `ONKING_MUSIC_06_TOKEN`

Each folder reads only its matching token. Do not use the same token for more than one instance.

## CloudCord MultiBot layout
Upload the contents of this directory as six sibling bot folders in the MultiBot server:
`music-01`, `music-02`, ... `music-06`.
Each folder contains its own `index.js`, `music.js`, and `package.json`.
MultiBot should install each folder's dependencies and run its `start` script.

## First test
1. Start only `music-01` and `music-02` initially if the panel allows individual starts.
2. Confirm both bots appear online in Discord.
3. Join two different voice rooms. Run `/เปิด` with a public YouTube URL using the corresponding bot's command.
4. Confirm both rooms play independently, then test pause, resume, skip, queue and volume.
5. Only then start instances 03–06 and monitor CPU, RAM and network usage.

## Commands
Thai command names appear when the Discord client's language is Thai:
- `/เปิด` (YouTube URL)
- `/หยุด`
- `/เล่นต่อ`
- `/ข้าม`
- `/คิว`
- `/เสียง` (1–100)
- `/ปิดเพลง`

Each bot remembers the last voice channel it used after restart. To use a bot in a different
room, invoke that bot while you are in the intended voice channel.
