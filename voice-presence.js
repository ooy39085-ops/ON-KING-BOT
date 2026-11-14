const fs = require("node:fs");
const path = require("node:path");
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const CONFIG_PATH = path.join(process.cwd(), "onking-voice-presence.json");
let settings = {};
const reconnectingGuilds = new Set();

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) settings = saved;
  }
} catch (error) {
  console.error("อ่านการตั้งค่าห้องเสียงประจำไม่สำเร็จ:", error.message);
}

function saveSettings() {
  const tempPath = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tempPath, CONFIG_PATH);
}

async function connectToPermanentRoom(client, guildId) {
  const channelId = settings[guildId];
  if (!channelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) {
    console.error("ไม่พบห้องเสียงประจำของเซิร์ฟเวอร์ " + guild.name);
    return;
  }

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me || !channel.permissionsFor(me)?.has("Connect")) {
    console.error("ON KING BOT ไม่มีสิทธิ์ Connect ในห้องเสียงประจำ: " + channel.name);
    return;
  }

  const previousConnection = getVoiceConnection(guild.id);
  if (previousConnection && previousConnection.joinConfig.channelId !== channel.id) {
    previousConnection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log("ON KING BOT ออนห้องเสียงประจำแล้ว: " + channel.name);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (reconnectingGuilds.has(guildId)) return;
    reconnectingGuilds.add(guildId);
    try {
      await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
      reconnectingGuilds.delete(guildId);
    } catch {
      connection.destroy();
      setTimeout(() => {
        reconnectingGuilds.delete(guildId);
        connectToPermanentRoom(client, guildId).catch(error =>
          console.error("เชื่อมต่อห้องเสียงประจำอีกครั้งไม่สำเร็จ:", error)
        );
      }, 5_000);
    }
  });

  connection.on("error", error => {
    console.error("ON KING BOT voice connection error:", error);
  });
}

async function setPermanentVoiceChannel(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("ไม่พบเซิร์ฟเวอร์ Discord");

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== 2) {
    throw new Error("กรุณาเลือกห้องเสียงปกติเท่านั้น");
  }

  const me = await guild.members.fetchMe();
  const needed = ["ViewChannel", "Connect"];
  if (!channel.permissionsFor(me)?.has(needed)) {
    throw new Error("บอทต้องมีสิทธิ์ View Channel และ Connect ในห้องนี้");
  }

  settings[guildId] = channelId;
  saveSettings();

  // Connect immediately; saved setting is retained if a transient connection error occurs.
  await connectToPermanentRoom(client, guildId);
  return channel;
}

async function restoreVoicePresence(client) {
  for (const guildId of Object.keys(settings)) {
    await connectToPermanentRoom(client, guildId);
  }
}

module.exports = { restoreVoicePresence, setPermanentVoiceChannel };
