const fs = require("node:fs");
const path = require("node:path");
const play = require("play-dl");
const {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  getVoiceConnection,
  entersState
} = require("@discordjs/voice");
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");
const {
  getPermanentVoiceChannelId,
  getPermanentVoiceConnection,
  setPermanentVoiceMute
} = require("./voice-presence");

const sessions = new Map();
const MAX_QUEUE_ITEMS = 100;

function parseYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (!["youtube.com", "youtu.be"].includes(host)) return null;
    const isPlaylist = host === "youtube.com" &&
      (url.pathname === "/playlist" || url.searchParams.has("list"));
    const isVideo = host === "youtu.be" ||
      url.pathname === "/watch" ||
      url.pathname.startsWith("/shorts/") ||
      url.pathname.startsWith("/live/");
    if (!isPlaylist && !isVideo) return null;
    return { url: url.toString(), isPlaylist };
  } catch {
    return null;
  }
}

function getSession(guildId) {
  if (!sessions.has(guildId)) {
    const player = createAudioPlayer();
    const session = {
      player,
      connection: null,
      queue: [],
      current: null,
      volume: 0.5,
      starting: false
    };

    player.on(AudioPlayerStatus.Idle, () => {
      if (session.current) session.current = null;
      if (session.queue.length) {
        setImmediate(() => playNext(guildId).catch(error =>
          console.error("เล่นเพลงถัดไปไม่สำเร็จ:", error.message)
        ));
      } else {
        setPermanentVoiceMute(guildId, true).catch(error =>
          console.error("ปิดไมค์หลังจบเพลงไม่สำเร็จ:", error.message)
        );
      }
    });

    player.on("error", error => {
      console.error("ON KING MUSIC player error:", error.message);
      session.current = null;
      if (session.queue.length) {
        setImmediate(() => playNext(guildId).catch(nextError =>
          console.error("เล่นเพลงถัดไปไม่สำเร็จ:", nextError.message)
        ));
      }
    });

    sessions.set(guildId, session);
  }
  return sessions.get(guildId);
}

async function connectToPermanentChannel(guildId) {
  const session = getSession(guildId);
  const channelId = getPermanentVoiceChannelId(guildId);
  const connection = getPermanentVoiceConnection(guildId);

  if (!channelId || !connection) {
    throw new Error("บอทยังไม่ได้ตั้งค่าห้องเสียงประจำ หรือยังไม่ได้ออนห้องครับ");
  }
  if (connection.joinConfig.channelId !== channelId) {
    throw new Error("บอทไม่ได้เชื่อมต่ออยู่ในห้องเสียงประจำครับ");
  }

  await entersState(connection, VoiceConnectionStatus.Ready, 20000);
  session.connection = connection;
  connection.subscribe(session.player);
  return session;
}

async function playNext(guildId) {
  const session = getSession(guildId);
  if (session.starting || !session.queue.length || !session.connection) return;

  session.starting = true;
  const item = session.queue.shift();
  session.current = item;

  try {
    console.log("ON KING MUSIC preparing:", item.title);
    const stream = await play.stream(item.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });
    if (resource.volume) resource.volume.setVolume(session.volume);
    await setPermanentVoiceMute(guildId, false);
    session.player.play(resource);
    console.log("ON KING MUSIC playing:", item.title);
  } catch (error) {
    console.error("ON KING MUSIC YouTube stream failed:", item.url, error.message);
    session.current = null;
  } finally {
    session.starting = false;
    if (!session.current && session.queue.length) {
      setImmediate(() => playNext(guildId).catch(error =>
        console.error("ON KING MUSIC queue recovery failed:", error.message)
      ));
    }
  }
}

async function resolveTracks(urlInfo) {
  if (urlInfo.isPlaylist) {
    const playlist = await play.playlist_info(urlInfo.url, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos
      .filter(video => video && (video.url || video.id))
      .slice(0, MAX_QUEUE_ITEMS)
      .map(video => ({
        url: video.url || "https://www.youtube.com/watch?v=" + video.id,
        title: video.title || "YouTube playlist track"
      }));
  }

  const info = await play.video_info(urlInfo.url);
  const video = info.video_details;
  return [{
    url: urlInfo.url,
    title: video?.title || "YouTube audio"
  }];
}

const localizedCommand = (name, thai) =>
  new SlashCommandBuilder()
    .setName(name)
    .setNameLocalizations({ th: thai });

const musicCommands = [
  localizedCommand("play", "เปิด")
    .setDescription("เล่นเพลงหรือ Playlist จาก YouTube")
    .addStringOption(option =>
      option
        .setName("url")
        .setNameLocalizations({ th: "ลิงก์" })
        .setDescription("ลิงก์ YouTube หรือ Playlist")
        .setRequired(true)
    ),
  localizedCommand("pause", "หยุด").setDescription("หยุดเพลงชั่วคราว"),
  localizedCommand("resume", "เล่นต่อ").setDescription("เล่นเพลงต่อ"),
  localizedCommand("skip", "ข้าม").setDescription("ข้ามเพลงปัจจุบัน"),
  localizedCommand("queue", "คิว").setDescription("ดูเพลงที่กำลังเล่นและรายการในคิว"),
  localizedCommand("volume", "เสียง")
    .setDescription("ปรับระดับเสียง 1 ถึง 100")
    .addIntegerOption(option =>
      option
        .setName("level")
        .setNameLocalizations({ th: "ระดับ" })
        .setDescription("ระดับเสียง 1-100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),
  localizedCommand("stopmusic", "ปิดเพลง").setDescription("หยุดเพลงและล้างคิว แต่บอทยังคงอยู่ในห้องเสียง")
].map(command => command.toJSON());

async function handleMusicInteraction(interaction) {
  const commandNames = [
    "play", "เปิด", "pause", "หยุด", "resume", "เล่นต่อ",
    "skip", "ข้าม", "queue", "คิว", "volume", "เสียง",
    "stopmusic", "ปิดเพลง"
  ];

  if (!interaction.isChatInputCommand() || !commandNames.includes(interaction.commandName)) {
    return false;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: "ใช้ ON KING MUSIC ได้เฉพาะในเซิร์ฟเวอร์ครับ", ephemeral: true });
    return true;
  }

  const guildId = interaction.guildId;
  const session = getSession(guildId);
  const command = interaction.commandName;

  if (["play", "เปิด"].includes(command)) {
    const rawUrl = interaction.options.getString("url", true).trim();
    const urlInfo = parseYouTubeUrl(rawUrl);

    if (!urlInfo) {
      await interaction.reply({
        content: "ลิงก์ไม่ถูกต้องครับ กรุณาใช้ลิงก์ YouTube วิดีโอ, Shorts หรือ Playlist ที่เปิดให้เข้าถึงได้",
        ephemeral: true
      });
      return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: "กรุณาเข้าห้องเสียงที่ต้องการฟังก่อน แล้วใช้ /เปิด อีกครั้งครับ",
        ephemeral: true
      });
      return true;
    }

    const botMember = await interaction.guild.members.fetchMe();
    const permissions = voiceChannel.permissionsFor(botMember);
    if (!permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak
    ])) {
      await interaction.reply({
        content: "บอทไม่มีสิทธิ์เข้าห้องหรือพูดในห้องเสียงนี้ครับ กรุณาตรวจสอบ View Channel, Connect และ Speak",
        ephemeral: true
      });
      return true;
    }

    await interaction.deferReply();
    try {
      const permanentChannelId = getPermanentVoiceChannelId(guildId);
      if (!permanentChannelId || voiceChannel.id !== permanentChannelId) {
        await interaction.editReply("กรุณาเข้าห้องเสียงประจำที่ ON KING BOT ออนอยู่ก่อนใช้คำสั่งเพลงครับ");
        return true;
      }
      await connectToPermanentChannel(guildId);

      const tracks = await resolveTracks(urlInfo);
      if (!tracks.length) {
        await interaction.editReply("ไม่พบเพลงใน Playlist นี้ครับ หรือ Playlist อาจเป็นส่วนตัว");
        return true;
      }

      const roomLeft = Math.max(0, MAX_QUEUE_ITEMS - session.queue.length - (session.current ? 1 : 0));
      const acceptedTracks = tracks.slice(0, roomLeft);
      if (!acceptedTracks.length) {
        await interaction.editReply("คิวเพลงเต็มแล้วครับ (จำกัด 100 รายการ) รอให้เพลงเดิมเล่นจบก่อนนะครับ");
        return true;
      }

      for (const track of acceptedTracks) {
        session.queue.push({
          url: track.url,
          title: track.title,
          requestedBy: interaction.user.id
        });
      }

      const playlistLabel = urlInfo.isPlaylist
        ? "เพิ่ม Playlist จำนวน " + acceptedTracks.length + " เพลง"
        : "เพิ่มเพลง";
      if (!session.current && !session.starting) {
        await playNext(guildId);
      }

      await interaction.editReply(
        "🎵 " + playlistLabel + " ลงคิวแล้วครับ\n" +
        "ใช้ /คิว เพื่อตรวจสอบรายการได้เลย" +
        (tracks.length > acceptedTracks.length ? "\nหมายเหตุ: เพิ่มได้สูงสุดตามพื้นที่คิวที่เหลือครับ" : "")
      );
    } catch (error) {
      console.error("ON KING MUSIC เพิ่มรายการไม่สำเร็จ:", error);
      await interaction.editReply(
        "เพิ่มเพลงไม่สำเร็จครับ ลองตรวจสอบว่าลิงก์เป็นสาธารณะและยังเปิดเล่นได้หรือไม่"
      );
    }
    return true;
  }

  if (["pause", "หยุด"].includes(command)) {
    const paused = session.player.pause();
    await interaction.reply({
      content: paused ? "⏸️ หยุดเพลงชั่วคราวแล้วครับ" : "ตอนนี้ไม่มีเพลงที่กำลังเล่นครับ",
      ephemeral: true
    });
    return true;
  }

  if (["resume", "เล่นต่อ"].includes(command)) {
    const resumed = session.player.unpause();
    await interaction.reply({
      content: resumed ? "▶️ เล่นเพลงต่อแล้วครับ" : "ไม่มีเพลงที่หยุดค้างไว้ครับ",
      ephemeral: true
    });
    return true;
  }

  if (["skip", "ข้าม"].includes(command)) {
    if (!session.current) {
      await interaction.reply({ content: "ตอนนี้ไม่มีเพลงที่กำลังเล่นครับ", ephemeral: true });
    } else {
      session.player.stop(true);
      await interaction.reply({ content: "⏭️ ข้ามเพลงแล้วครับ", ephemeral: true });
    }
    return true;
  }

  if (["queue", "คิว"].includes(command)) {
    const lines = [
      session.current ? "กำลังเล่น/กำลังโหลด: **" + session.current.title + "**" : "ยังไม่มีเพลงที่กำลังเล่น",
      ...session.queue.slice(0, 20).map((track, index) =>
        (index + 1) + ". " + track.title
      )
    ];
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xD4AF37)
          .setTitle("ON KING MUSIC • QUEUE")
          .setDescription(lines.join("\n").slice(0, 4000))
      ],
      ephemeral: true
    });
    return true;
  }

  if (["volume", "เสียง"].includes(command)) {
    session.volume = interaction.options.getInteger("level", true) / 100;
    const resource = session.player.state.resource;
    if (resource?.volume) resource.volume.setVolume(session.volume);
    await interaction.reply({
      content: "ตั้งระดับเสียงเป็น " + Math.round(session.volume * 100) + "% แล้วครับ",
      ephemeral: true
    });
    return true;
  }

  if (["stopmusic", "ปิดเพลง"].includes(command)) {
    session.queue = [];
    session.current = null;
    session.player.stop(true);
    await interaction.reply({
      content: "หยุดเพลงและล้างคิวแล้วครับ บอทยังคงอยู่ในห้องเสียง",
      ephemeral: true
    });
    return true;
  }

  return false;
}

module.exports = {
  musicCommands,
  handleMusicInteraction
};
