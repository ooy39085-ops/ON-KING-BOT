const fs = require("node:fs");
const path = require("node:path");
const play = require("play-dl");
const { AudioPlayerStatus, VoiceConnectionStatus, createAudioPlayer, createAudioResource, joinVoiceChannel, entersState } = require("@discordjs/voice");
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const CONFIG_PATH = path.join(process.cwd(), "on-king-music-config.json");
let settings = {};
try { if (fs.existsSync(CONFIG_PATH)) settings = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { console.error("อ่านการตั้งค่า MUSIC ไม่สำเร็จ:", e.message); }
const sessions = new Map();
function saveSettings() { const tmp = CONFIG_PATH + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8"); fs.renameSync(tmp, CONFIG_PATH); }
function isYouTubeUrl(value) { try { const u = new URL(value); return ["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtu.be"].includes(u.hostname) && (u.hostname.includes("youtu.be") || u.pathname === "/watch" || u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/live/")); } catch { return false; } }
function getSession(id) {
 if (!sessions.has(id)) { const player = createAudioPlayer(); const s = { player, connection: null, queue: [], current: null, volume: 0.5, starting: false };
 player.on(AudioPlayerStatus.Idle, () => { s.current = null; if (s.queue.length) playNext(id).catch(e => console.error("เพลงถัดไปผิดพลาด:", e.message)); });
 player.on("error", e => { console.error("MUSIC player error:", e.message); s.current = null; if (s.queue.length) playNext(id).catch(() => {}); }); sessions.set(id, s); } return sessions.get(id);
}
async function connectToChannel(channel) { const s = getSession(channel.guild.id); if (s.connection && s.connection.joinConfig.channelId === channel.id) return s; if (s.connection) s.connection.destroy();
 const c = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true }); s.connection = c; c.subscribe(s.player);
 c.on(VoiceConnectionStatus.Disconnected, async () => { try { await Promise.race([entersState(c, VoiceConnectionStatus.Signalling, 5000), entersState(c, VoiceConnectionStatus.Connecting, 5000)]); } catch { if (s.connection === c) c.destroy(); } });
 await entersState(c, VoiceConnectionStatus.Ready, 20000); return s;
}
async function playNext(id) { const s = getSession(id); if (s.starting || !s.queue.length || !s.connection) return; s.starting = true; const item = s.queue.shift();
 try { const stream = await play.stream(item.url, { quality: 2 }); const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true }); resource.volume.setVolume(s.volume); s.current = item; s.player.play(resource); console.log("ON KING MUSIC playing:", item.title); }
 catch (e) { console.error("YouTube stream failed:", e.message); s.current = null; setImmediate(() => playNext(id).catch(() => {})); } finally { s.starting = false; }
}
const th = (name, thai) => new SlashCommandBuilder().setName(name).setNameLocalizations({ th: thai });
const musicCommands = [
 th("play","เปิด").setDescription("เล่นเพลงหรือคลิปเสียงจาก YouTube").addStringOption(o => o.setName("url").setNameLocalizations({th:"ลิงก์"}).setDescription("ลิงก์ YouTube").setRequired(true)),
 th("pause","หยุด").setDescription("หยุดเพลงชั่วคราว"), th("resume","เล่นต่อ").setDescription("เล่นเพลงต่อ"), th("skip","ข้าม").setDescription("ข้ามเพลงปัจจุบัน"), th("queue","คิว").setDescription("ดูคิวเพลง"),
 th("volume","เสียง").setDescription("ปรับระดับเสียง 1 ถึง 100").addIntegerOption(o => o.setName("level").setNameLocalizations({th:"ระดับ"}).setDescription("ระดับเสียง 1-100").setMinValue(1).setMaxValue(100).setRequired(true)),
 th("stopmusic","ปิดเพลง").setDescription("หยุดเพลงและล้างคิว แต่บอทยังค้างในห้องเสียง"),
 th("musicsetup","ตั้งค่าห้องเพลง").setDescription("กำหนดห้องเสียงประจำของ ON KING MUSIC").addChannelOption(o => o.setName("channel").setNameLocalizations({th:"ห้องเสียง"}).setDescription("เลือกห้องเสียงประจำ").addChannelTypes(ChannelType.GuildVoice,ChannelType.GuildStageVoice).setRequired(true))
].map(c => c.toJSON());
async function restoreMusicConnections(client) { for (const [gid, cfg] of Object.entries(settings)) { const g = client.guilds.cache.get(gid); if (!g || !cfg.voiceChannelId) continue; const ch = await g.channels.fetch(cfg.voiceChannelId).catch(() => null); if (!ch || ![ChannelType.GuildVoice,ChannelType.GuildStageVoice].includes(ch.type)) { console.warn("ไม่พบห้องประจำ MUSIC:", gid); continue; } try { await connectToChannel(ch); console.log("ON KING MUSIC connected:", g.name, ch.name); } catch (e) { console.error("เชื่อมต่อห้อง MUSIC ไม่สำเร็จ:", e.message); } } }
async function handleMusicInteraction(i) {
 const names = ["play","เปิด","pause","หยุด","resume","เล่นต่อ","skip","ข้าม","queue","คิว","volume","เสียง","stopmusic","ปิดเพลง","musicsetup","ตั้งค่าห้องเพลง"]; if (!i.isChatInputCommand() || !names.includes(i.commandName)) return false;
 if (!i.inGuild()) { await i.reply({content:"ใช้ได้เฉพาะในเซิร์ฟเวอร์ครับ",ephemeral:true}); return true; } const id=i.guildId, s=getSession(id), cmd=i.commandName;
 if (cmd==="musicsetup" || cmd==="ตั้งค่าห้องเพลง") { if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await i.reply({content:"คำสั่งนี้สำหรับแอดมินที่มีสิทธิ์ Manage Server เท่านั้นครับ",ephemeral:true}); return true; }
 const ch=i.options.getChannel("channel",true), me=await i.guild.members.fetchMe(); if (!ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak])) { await i.reply({content:"บอทต้องมีสิทธิ์ View Channel, Connect และ Speak ในห้องนี้ครับ",ephemeral:true}); return true; }
 try { await connectToChannel(ch); settings[id]={voiceChannelId:ch.id}; saveSettings(); await i.reply({content:"ตั้งค่าห้องประจำ ON KING MUSIC เป็น "+ch+" แล้วครับ บอทจะพยายามกลับเข้าห้องนี้หลัง Restart",ephemeral:true}); } catch(e) { console.error(e); await i.reply({content:"เชื่อมต่อห้องเสียงไม่สำเร็จ กรุณาตรวจสอบสิทธิ์บอทครับ",ephemeral:true}); } return true; }
 if (cmd==="play" || cmd==="เปิด") { const url=i.options.getString("url",true).trim(); if (!isYouTubeUrl(url)) { await i.reply({content:"รองรับลิงก์ YouTube แบบวิดีโอ, Shorts และ youtu.be เท่านั้นครับ",ephemeral:true}); return true; }
 const chId=settings[id]?.voiceChannelId, ch=chId ? (i.guild.channels.cache.get(chId)||await i.guild.channels.fetch(chId).catch(()=>null)) : null; if (!ch) { await i.reply({content:"แอดมินยังไม่ได้ตั้งค่าห้องประจำ ใช้ /ตั้งค่าห้องเพลง ก่อนครับ",ephemeral:true}); return true; }
 await i.deferReply(); try { await connectToChannel(ch); const info=await play.video_info(url); const title=info.video_details?.title||"YouTube audio"; s.queue.push({url,title,requestedBy:i.user.id}); if (!s.current && s.player.state.status!==AudioPlayerStatus.Playing && !s.starting) await playNext(id); await i.editReply("🎵 เพิ่ม **"+title.slice(0,150)+"** ลงคิวแล้วครับ"); } catch(e) { console.error("เพิ่มเพลงไม่สำเร็จ:",e); await i.editReply("เปิดลิงก์นี้ไม่สำเร็จครับ ลองตรวจสอบว่าคลิปเป็นสาธารณะและยังเล่นได้หรือไม่"); } return true; }
 if (cmd==="pause"||cmd==="หยุด") { const ok=s.player.pause(); await i.reply({content:ok?"⏸️ หยุดเพลงชั่วคราวแล้วครับ":"ตอนนี้ไม่มีเพลงที่กำลังเล่นครับ",ephemeral:true}); return true; }
 if (cmd==="resume"||cmd==="เล่นต่อ") { const ok=s.player.unpause(); await i.reply({content:ok?"▶️ เล่นเพลงต่อแล้วครับ":"ไม่มีเพลงที่หยุดค้างไว้ครับ",ephemeral:true}); return true; }
 if (cmd==="skip"||cmd==="ข้าม") { if (!s.current) await i.reply({content:"ตอนนี้ไม่มีเพลงที่กำลังเล่นครับ",ephemeral:true}); else { s.player.stop(true); await i.reply({content:"⏭️ ข้ามเพลงแล้วครับ",ephemeral:true}); } return true; }
 if (cmd==="queue"||cmd==="คิว") { const lines=[s.current?"กำลังเล่น: **"+s.current.title+"**":"ยังไม่มีเพลงที่กำลังเล่น",...s.queue.slice(0,15).map((x,n)=>(n+1)+". "+x.title)]; await i.reply({embeds:[new EmbedBuilder().setColor(0xD4AF37).setTitle("ON KING MUSIC • QUEUE").setDescription(lines.join("\n").slice(0,4000))],ephemeral:true}); return true; }
 if (cmd==="volume"||cmd==="เสียง") { s.volume=i.options.getInteger("level",true)/100; const r=s.player.state.resource; if(r?.volume) r.volume.setVolume(s.volume); await i.reply({content:"ตั้งระดับเสียงเป็น "+Math.round(s.volume*100)+"% แล้วครับ",ephemeral:true}); return true; }
 if (cmd==="stopmusic"||cmd==="ปิดเพลง") { s.queue=[]; s.current=null; s.player.stop(true); await i.reply({content:"หยุดเพลงและล้างคิวแล้วครับ บอทยังคงอยู่ในห้องเสียงประจำ",ephemeral:true}); return true; } return false;
}
module.exports={musicCommands,handleMusicInteraction,restoreMusicConnections};
