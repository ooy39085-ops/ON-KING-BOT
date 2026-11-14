const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const VOICE_CHANNEL_ID = process.env.ONKING_VOICE_CHANNEL_ID;
let reconnecting = false;

async function connectToPermanentRoom(client) {
  if (!VOICE_CHANNEL_ID) {
    console.warn("ยังไม่ได้ตั้ง ONKING_VOICE_CHANNEL_ID — ข้ามการออนห้องเสียงประจำ");
    return;
  }

  const channel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isVoiceBased() || !channel.guild) {
    console.error("ไม่พบห้องเสียงประจำ หรือ Channel ID ไม่ใช่ห้องเสียง");
    return;
  }

  const me = await channel.guild.members.fetchMe().catch(() => null);
  if (!me || !channel.permissionsFor(me)?.has("Connect")) {
    console.error("ON KING BOT ไม่มีสิทธิ์ Connect ในห้องเสียงประจำ");
    return;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log("ON KING BOT ออนห้องเสียงประจำแล้ว: " + channel.name);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (reconnecting) return;
    reconnecting = true;
    try {
      await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
      reconnecting = false;
    } catch {
      connection.destroy();
      setTimeout(() => {
        reconnecting = false;
        connectToPermanentRoom(client).catch(error =>
          console.error("เชื่อมต่อห้องเสียงประจำอีกครั้งไม่สำเร็จ:", error)
        );
      }, 5_000);
    }
  });

  connection.on("error", error => {
    console.error("ON KING BOT voice connection error:", error);
  });
}

async function restoreVoicePresence(client) {
  await connectToPermanentRoom(client);
}

module.exports = { restoreVoicePresence };
