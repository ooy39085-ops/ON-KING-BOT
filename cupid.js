"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require("discord.js");
const FILE = path.join(process.cwd(), "on-king-cupid-data.json");
const TTL = 3600000, INTERVAL = 30000;
let clientRef;
let data = { settings: {}, couples: [], pending: [], history: [], divorcePending: [] };
const timers = new Map();
try {
  if (fs.existsSync(FILE)) {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    data = { settings: saved.settings && typeof saved.settings === "object" ? saved.settings : {}, couples: Array.isArray(saved.couples) ? saved.couples : [], pending: Array.isArray(saved.pending) ? saved.pending : [], history: Array.isArray(saved.history) ? saved.history : [], divorcePending: Array.isArray(saved.divorcePending) ? saved.divorcePending : [] };
  }
} catch (e) { console.error("อ่านข้อมูล CUPID ไม่สำเร็จ:", e.message); }
for (const [guildId, settings] of Object.entries(data.settings)) {
  if (!settings.marriageRequestChannelId && settings.requestChannelId) settings.marriageRequestChannelId = settings.requestChannelId;
  if (!settings.marriageAnnouncementChannelId && settings.cardChannelId) settings.marriageAnnouncementChannelId = settings.cardChannelId;
  if (!settings.divorceAnnouncementChannelId && settings.breakupChannelId) settings.divorceAnnouncementChannelId = settings.breakupChannelId;
}
for (const req of data.pending) {
  if (!req.type) req.type = "marriage";
  if (!req.expiresAt) req.expiresAt = Number(req.createdAt || Date.now()) + TTL;
}
function save() { const tmp = FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, FILE); }
function coupleFor(gid, uid) { return data.couples.find(c => c.guildId === gid && (c.user1 === uid || c.user2 === uid)); }
function remaining(ts) { const ms = Math.max(0, ts - Date.now()); return Math.floor(ms / 60000) + " นาที " + Math.floor(ms % 60000 / 1000) + " วินาที"; }
function card(c, ended) {
  const a = clientRef.users.cache.get(c.user1), b = clientRef.users.cache.get(c.user2);
  const embed = new EmbedBuilder().setColor(ended ? 0x777777 : 0xD4AF37)
    .setTitle(ended ? "ON KING CUPID • RELATIONSHIP ENDED" : "💍 ON KING COUPLE")
    .setDescription(ended ? "ความสัมพันธ์ของคู่นี้สิ้นสุดลงแล้ว" : "ความรักบทใหม่เริ่มต้นขึ้นแล้วใน ON KING COMMUNITY")
    .addFields({ name: "สมาชิกคนที่ 1", value: "<@" + c.user1 + ">", inline: true }, { name: "♡", value: "💛", inline: true }, { name: "สมาชิกคนที่ 2", value: "<@" + c.user2 + ">", inline: true }, { name: ended ? "วันที่สิ้นสุด" : "วันที่เริ่มต้น", value: new Date(ended ? c.endedAt : c.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) })
    .setFooter({ text: "ON KING CUPID • LOVE IN THE KINGDOM" }).setTimestamp(c.createdAt);
  if (a) embed.setAuthor({ name: a.username, iconURL: a.displayAvatarURL({ extension: "png", size: 256 }) });
  if (b) embed.setThumbnail(b.displayAvatarURL({ extension: "png", size: 256 }));
  return embed;
}
function embedFor(r, expired) {
  const marriage = r.type === "marriage";
  return new EmbedBuilder().setColor(expired ? 0x777777 : marriage ? 0xD4AF37 : 0x777777)
    .setTitle(expired ? "⌛ ON KING CUPID • คำขอหมดเวลา" : marriage ? "💌 ON KING CUPID • คำขอแต่งงาน" : "🖤 ON KING CUPID • คำขอหย่าร้าง")
    .setDescription(expired ? "คำขอนี้หมดอายุแล้ว ไม่สามารถยืนยันได้ครับ" :
      "<@" + r.fromId + "> " + (marriage ? "ต้องการแต่งงานกับ" : "ขอหย่าร้างกับ") + " <@" + r.toId + ">\n\nมีเพียงผู้รับคำขอเท่านั้นที่ยืนยันหรือปฏิเสธได้\nเวลาที่เหลือ: **" + remaining(r.expiresAt) + "**")
    .setFooter({ text: "ON KING CUPID • คำขอมีอายุ 1 ชั่วโมง" }).setTimestamp(r.createdAt);
}
function buttons(r, disabled) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cupid_yes:" + r.id).setLabel(r.type === "marriage" ? "ยืนยันแต่งงาน" : "ยืนยันหย่าร้าง").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("cupid_no:" + r.id).setLabel("ปฏิเสธ").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  )];
}
async function messageFor(r) {
  const g = clientRef.guilds.cache.get(r.guildId);
  const ch = g ? await g.channels.fetch(r.channelId).catch(() => null) : null;
  return ch && ch.isTextBased() ? await ch.messages.fetch(r.messageId).catch(() => null) : null;
}
async function complete(r, result) {
  const idx = data.pending.findIndex(x => x.id === r.id);
  if (idx < 0) return;
  let outcome = result;
  let relationship = null;

  // Persist the relationship change together with request removal before any
  // Discord network calls, so a restart cannot lose an accepted request.
  if (result === "accepted" && r.type === "marriage") {
    if (coupleFor(r.guildId, r.fromId) || coupleFor(r.guildId, r.toId)) {
      outcome = "conflict";
    } else {
      relationship = { guildId: r.guildId, user1: r.fromId, user2: r.toId, createdAt: Date.now() };
      data.couples.push(relationship);
    }
  } else if (result === "accepted" && r.type === "divorce") {
    const coupleIndex = data.couples.findIndex(c => c.guildId === r.guildId &&
      ((c.user1 === r.fromId && c.user2 === r.toId) || (c.user2 === r.fromId && c.user1 === r.toId)));
    if (coupleIndex < 0) {
      outcome = "invalid";
    } else {
      relationship = data.couples[coupleIndex];
      relationship.endedAt = Date.now();
      data.couples.splice(coupleIndex, 1);
    }
  }

  data.pending.splice(idx, 1);
  data.history.push({ ...r, status: outcome, completedAt: Date.now() });
  save();
  const timer = timers.get(r.id);
  if (timer) clearInterval(timer);
  timers.delete(r.id);

  const msg = await messageFor(r);
  let finalEmbed;
  if (outcome === "expired") {
    finalEmbed = embedFor(r, true);
  } else if (outcome === "accepted") {
    finalEmbed = new EmbedBuilder().setColor(0xD4AF37)
      .setTitle("ON KING CUPID • ยืนยันเรียบร้อย")
      .setDescription("ดำเนินการเรียบร้อยสำหรับ <@" + r.fromId + "> และ <@" + r.toId + ">").setTimestamp();
  } else if (outcome === "conflict") {
    finalEmbed = new EmbedBuilder().setColor(0x777777)
      .setTitle("ON KING CUPID • ไม่สามารถสร้างคู่รักได้")
      .setDescription("ไม่สามารถยืนยันคำขอได้ เพราะสมาชิกคนใดคนหนึ่งมีคู่รักอยู่แล้วครับ").setTimestamp();
  } else if (outcome === "invalid") {
    finalEmbed = new EmbedBuilder().setColor(0x777777)
      .setTitle("ON KING CUPID • ไม่พบสถานะคู่สมรส")
      .setDescription("ไม่สามารถยืนยันการหย่าร้างได้ เพราะไม่พบสถานะคู่สมรสเดิมครับ").setTimestamp();
  } else {
    finalEmbed = new EmbedBuilder().setColor(0x777777)
      .setTitle("ON KING CUPID • คำขอถูกปฏิเสธ")
      .setDescription("<@" + r.toId + "> ปฏิเสธคำขอจาก <@" + r.fromId + ">").setTimestamp();
  }
  if (msg) await msg.edit({ embeds: [finalEmbed], components: buttons(r, true) }).catch(() => {});

  const notice = outcome === "expired" ? "⌛ คำขอ ON KING CUPID หมดเวลา 1 ชั่วโมงแล้วครับ"
    : outcome === "accepted" ? (r.type === "marriage" ? "💛 คำขอแต่งงาน ON KING CUPID ได้รับการยืนยันแล้วครับ" : "💛 คำขอหย่าร้าง ON KING CUPID ได้รับการยืนยันแล้วครับ")
    : outcome === "conflict" || outcome === "invalid" ? "ไม่สามารถดำเนินการตามคำขอ ON KING CUPID ได้ครับ"
    : "คำขอ ON KING CUPID ถูกปฏิเสธครับ";
  for (const uid of [r.fromId, r.toId]) {
    const u = await clientRef.users.fetch(uid).catch(() => null);
    if (u) await u.send(notice).catch(() => {});
  }

  if (outcome !== "accepted" || !relationship) return;
  const guild = clientRef.guilds.cache.get(r.guildId);
  if (!guild) return;
  if (r.type === "marriage") {
    const chId = data.settings[r.guildId]?.marriageAnnouncementChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch && ch.isTextBased()) {
      const posted = await ch.send({ embeds: [card(relationship, false)] }).catch(() => null);
      if (posted) {
        relationship.cardChannelId = ch.id;
        relationship.cardMessageId = posted.id;
        save();
      }
    }
  } else {
    const old = relationship.cardChannelId ? await guild.channels.fetch(relationship.cardChannelId).catch(() => null) : null;
    const oldMsg = old && relationship.cardMessageId ? await old.messages.fetch(relationship.cardMessageId).catch(() => null) : null;
    if (oldMsg) await oldMsg.edit({ embeds: [card(relationship, true)] }).catch(() => {});
    const chId = data.settings[r.guildId]?.divorceAnnouncementChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch && ch.isTextBased()) await ch.send({ embeds: [card(relationship, true)] }).catch(() => {});
  }
}
function schedule(r) {
  if (timers.has(r.id)) clearInterval(timers.get(r.id));
  const tick = async () => {
    const current = data.pending.find(x => x.id === r.id);
    if (!current) { clearInterval(timers.get(r.id)); timers.delete(r.id); return; }
    if (Date.now() >= current.expiresAt) return complete(current, "expired");
    const msg = await messageFor(current);
    if (msg) await msg.edit({ embeds: [embedFor(current, false)], components: buttons(current, false) }).catch(() => {});
  };
  timers.set(r.id, setInterval(tick, INTERVAL));
  if (r.expiresAt <= Date.now()) tick();
}
async function panel(ch, type) {
  const marriage = type === "marriage";
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(marriage ? "cupid_start_marriage" : "cupid_start_divorce").setLabel(marriage ? "ขอแต่งงาน" : "ขอหย่าร้าง").setStyle(marriage ? ButtonStyle.Success : ButtonStyle.Secondary));
  const e = new EmbedBuilder().setColor(0xD4AF37).setTitle(marriage ? "👑 ON KING CUPID • ขอแต่งงาน" : "🖤 ON KING CUPID • ขอหย่าร้าง")
    .setDescription(marriage ? "กดปุ่มเพื่อเลือกสมาชิกที่ต้องการขอแต่งงาน อีกฝ่ายต้องยืนยันก่อนจึงจะประกาศการ์ดคู่รัก" : "กดปุ่มเพื่อส่งคำขอหย่าร้างให้คู่สมรส การหย่าร้างจะมีผลเมื่ออีกฝ่ายยืนยันเท่านั้น");
  await ch.send({ embeds: [e], components: [row] });
}
async function makeRequest(interaction, type, targetId) {
  const gid = interaction.guildId, from = interaction.user.id;
  let to = targetId;
  if (type === "divorce") {
    const c = coupleFor(gid, from);
    if (!c) { await interaction.reply({ content: "คุณยังไม่มีสถานะคู่สมรสใน ON KING CUPID ครับ", ephemeral: true }); return; }
    to = c.user1 === from ? c.user2 : c.user1;
  } else {
    const target = await interaction.client.users.fetch(to).catch(() => null);
    if (!target || target.bot || to === from) { await interaction.reply({ content: "กรุณาเลือกสมาชิกคนอื่นที่ไม่ใช่บอทครับ", ephemeral: true }); return; }
    if (coupleFor(gid, from) || coupleFor(gid, to)) { await interaction.reply({ content: "คุณหรือสมาชิกที่เลือกมีคู่รักอยู่แล้วครับ", ephemeral: true }); return; }
  }
  const busy = data.pending.some(p => p.guildId === gid && [p.fromId, p.toId].some(id => id === from || id === to));
  if (busy) { await interaction.reply({ content: "คุณหรืออีกฝ่ายมีคำขอที่รอการยืนยันอยู่แล้วครับ", ephemeral: true }); return; }
  const settings = data.settings[gid] || {};
  const channelId = type === "marriage" ? settings.marriageRequestChannelId : settings.divorceRequestChannelId;
  const ch = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
  if (!ch || !ch.isTextBased()) { await interaction.reply({ content: "ยังไม่ได้ตั้งค่าห้องคำขอประเภทนี้ครับ", ephemeral: true }); return; }
  const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), type, guildId: gid, fromId: from, toId: to, createdAt: Date.now(), expiresAt: Date.now() + TTL };
  const m = await ch.send({ content: "<@" + to + ">", embeds: [embedFor(r, false)], components: buttons(r, false), allowedMentions: { users: [to] } });
  r.channelId = ch.id; r.messageId = m.id; data.pending.push(r); save(); schedule(r);
  await interaction.reply({ content: "ส่งคำขอแล้วครับ อีกฝ่ายมีเวลา 1 ชั่วโมงในการยืนยัน", ephemeral: true });
}
const commands = [
  new SlashCommandBuilder().setName("marriage").setDescription("ส่งคำขอแต่งงานให้สมาชิกที่เลือก")
    .addUserOption(o => o.setName("member").setDescription("สมาชิกที่ต้องการขอแต่งงาน").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("breakup").setDescription("ส่งคำขอหย่าร้างให้คู่สมรสของคุณ").toJSON(),
  new SlashCommandBuilder().setName("cupid-setup").setDescription("ตั้งค่าห้องคำขอและห้องประกาศ ON KING CUPID").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName("marriage_request").setDescription("ห้องคำขอแต่งงาน").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName("marriage_announcement").setDescription("ห้องประกาศแต่งงาน").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName("divorce_request").setDescription("ห้องคำขอหย่าร้าง").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName("divorce_announcement").setDescription("ห้องประกาศหย่าร้าง").addChannelTypes(ChannelType.GuildText).setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("checkcouple").setDescription("ตรวจสอบสถานะคู่รัก ON KING CUPID")
    .addUserOption(o => o.setName("member").setDescription("สมาชิกที่ต้องการตรวจสอบ").setRequired(false)).toJSON()
];
async function handle(i) {
  if (i.isChatInputCommand() && i.commandName === "marriage") {
    const target = i.options.getUser("member", true);
    await makeRequest(i, "marriage", target.id);
    return true;
  }
  if (i.isChatInputCommand() && i.commandName === "breakup") {
    await makeRequest(i, "divorce");
    return true;
  }
  if (i.isChatInputCommand() && i.commandName === "checkcouple") {
    const target = i.options.getUser("member") || i.user;
    const c = coupleFor(i.guildId, target.id);
    if (!c) {
      await i.reply({ content: "💛 <@" + target.id + "> ยังไม่มีสถานะคู่รักใน ON KING CUPID ครับ", ephemeral: true });
      return true;
    }
    const partnerId = c.user1 === target.id ? c.user2 : c.user1;
    await i.reply({
      embeds: [new EmbedBuilder().setColor(0xD4AF37).setTitle("💍 ON KING CUPID • ตรวจสอบคู่รัก")
        .setDescription("<@" + target.id + "> ♡ <@" + partnerId + ">")
        .addFields({ name: "สมาชิกที่ตรวจสอบ", value: "<@" + target.id + ">", inline: true },
          { name: "คู่รัก", value: "<@" + partnerId + ">", inline: true },
          { name: "วันที่เริ่มต้น", value: new Date(c.createdAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) })
        .setFooter({ text: "ON KING COMMUNITY • LOVE IN THE KINGDOM" }).setTimestamp(c.createdAt)],
      ephemeral: false
    });
    return true;
  }
  if (i.isChatInputCommand() && i.commandName === "cupid-setup") {
    const c = { marriageRequestChannelId: i.options.getChannel("marriage_request", true), marriageAnnouncementChannelId: i.options.getChannel("marriage_announcement", true), divorceRequestChannelId: i.options.getChannel("divorce_request", true), divorceAnnouncementChannelId: i.options.getChannel("divorce_announcement", true) };
    const me = await i.guild.members.fetchMe(), needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (Object.values(c).some(ch => !ch.permissionsFor(me)?.has(needed))) { await i.reply({ content: "บอทต้องมีสิทธิ์ View Channel, Send Messages และ Embed Links ในทุกห้องครับ", ephemeral: true }); return true; }
    data.settings[i.guildId] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.id])); save();
    await panel(i.options.getChannel("marriage_request", true), "marriage"); await panel(i.options.getChannel("divorce_request", true), "divorce");
    await i.reply({ content: "ตั้งค่า ON KING CUPID และส่งแผงปุ่มทั้งสองห้องเรียบร้อยแล้วครับ", ephemeral: true }); return true;
  }
  if (i.isButton()) {
    if (i.customId === "cupid_start_marriage") {
      await i.reply({ content: "เลือกสมาชิกที่ต้องการขอแต่งงานครับ", components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("cupid_pick_marriage").setPlaceholder("เลือกสมาชิก").setMinValues(1).setMaxValues(1))], ephemeral: true }); return true;
    }
    if (i.customId === "cupid_start_divorce") { await makeRequest(i, "divorce"); return true; }
    if (i.customId.startsWith("cupid_yes:") || i.customId.startsWith("cupid_no:") || i.customId.startsWith("cupid_accept:") || i.customId.startsWith("cupid_decline:")) {
      const parts = i.customId.split(":"), r = data.pending.find(x => x.id === parts[1] && x.guildId === i.guildId);
      if (!r) { await i.reply({ content: "คำขอนี้หมดเวลาหรือถูกดำเนินการแล้วครับ", ephemeral: true }); return true; }
      if (Date.now() >= r.expiresAt) {
        await i.deferReply({ ephemeral: true });
        await complete(r, "expired");
        await i.editReply({ content: "คำขอนี้หมดเวลาแล้วครับ" });
        return true;
      }
      if (i.user.id !== r.toId) { await i.reply({ content: "เฉพาะสมาชิกที่ได้รับคำขอเท่านั้นที่กดตอบได้ครับ", ephemeral: true }); return true; }
      await i.deferUpdate(); await complete(r, (parts[0] === "cupid_yes" || parts[0] === "cupid_accept") ? "accepted" : "declined"); return true;
    }
  }
  if (i.isUserSelectMenu() && i.customId === "cupid_pick_marriage") { await makeRequest(i, "marriage", i.values[0]); return true; }
  return false;
}
async function restore(client) {
  clientRef = client;
  for (const r of [...data.pending]) { if (r.expiresAt <= Date.now()) await complete(r, "expired"); else schedule(r); }
}
function init(client) { clientRef = client; }
module.exports = { commands, handle, restore, init };
