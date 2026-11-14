const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const syncSecret = process.env.DISCORD_SYNC_SECRET;
const supabaseUrl = (process.env.SUPABASE_URL || "https://alfaddeavpefqobspvxt.supabase.co").replace(/\/$/, "");
const syncUrl = `${supabaseUrl}/functions/v1/discord-member-sync`;
const CONFIG_PATH = path.join(process.cwd(), "sweet-match-config.json");
const SEARCH_TIMEOUT_MS = 3 * 60 * 1000;

if (!token) {
  console.error("ไม่พบ DISCORD_BOT_TOKEN ใน Environment Variables");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Sweet Match settings are stored locally on the bot host. No website or Supabase
// schema is used by this feature.
let sweetSettings = {};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    sweetSettings = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
} catch (error) {
  console.error("อ่านไฟล์ตั้งค่า Sweet Match ไม่สำเร็จ:", error.message);
  sweetSettings = {};
}

const searchQueues = new Map();       // guildId -> [{ userId, gender, preference, interaction, timer }]
const selections = new Map();         // userId -> { gender, preference }
const activeMatches = new Map();      // voiceChannelId -> { guildId, userIds, ended }
const activeUsers = new Map();        // userId -> voiceChannelId

function saveSweetSettings() {
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(sweetSettings, null, 2), "utf8");
  fs.renameSync(tempPath, CONFIG_PATH);
}

function getQueue(guildId) {
  if (!searchQueues.has(guildId)) searchQueues.set(guildId, []);
  return searchQueues.get(guildId);
}

function isCompatible(a, b) {
  const accepts = (preference, gender) => preference === "any" || preference === gender;
  return accepts(a.preference, b.gender) && accepts(b.preference, a.gender);
}

function genderLabel(value) {
  return ({ male: "ชาย", female: "หญิง", unspecified: "ไม่ระบุ" })[value] || "ไม่ระบุ";
}

function preferenceLabel(value) {
  return ({ male: "ชาย", female: "หญิง", any: "ไม่จำกัดเพศ" })[value] || "ไม่จำกัดเพศ";
}

function selectionComponents(userId, selection = {}) {
  const genderOptions = [
    { label: "ชาย", value: "male", description: "ระบุเพศของตัวเองเป็นชาย" },
    { label: "หญิง", value: "female", description: "ระบุเพศของตัวเองเป็นหญิง" },
    { label: "ไม่ระบุ", value: "unspecified", description: "ไม่ต้องการระบุเพศของตัวเอง" }
  ].map(option => ({ ...option, default: selection.gender === option.value }));

  const preferenceOptions = [
    { label: "ชาย", value: "male", description: "ต้องการพบผู้ชาย" },
    { label: "หญิง", value: "female", description: "ต้องการพบผู้หญิง" },
    { label: "ไม่จำกัดเพศ", value: "any", description: "เปิดรับทุกเพศ รวมถึงผู้ไม่ระบุเพศ" }
  ].map(option => ({ ...option, default: selection.preference === option.value }));

  const genderMenu = new StringSelectMenuBuilder()
    .setCustomId(`sm_gender:${userId}`)
    .setPlaceholder("เลือกเพศของตัวเอง")
    .addOptions(genderOptions);

  const preferenceMenu = new StringSelectMenuBuilder()
    .setCustomId(`sm_preference:${userId}`)
    .setPlaceholder("เลือกเพศที่ต้องการพบ")
    .addOptions(preferenceOptions);

  const ready = Boolean(selection.gender && selection.preference);
  const submit = new ButtonBuilder()
    .setCustomId("sm_submit")
    .setLabel("เริ่มค้นหาคู่")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!ready);

  return [
    new ActionRowBuilder().addComponents(genderMenu),
    new ActionRowBuilder().addComponents(preferenceMenu),
    new ActionRowBuilder().addComponents(submit)
  ];
}

function createPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle("👑 ON KING SWEET MATCH")
    .setDescription([
      "กดปุ่มด้านล่างเพื่อเริ่มค้นหาคนที่ต้องการพูดคุย",
      "",
      "• เลือกเพศของตัวเองและเพศที่ต้องการพบ",
      "• ระบบจับคู่เมื่อเงื่อนไขตรงกันทั้งสองฝ่าย",
      "• ค้นหาสูงสุด 3 นาที หากไม่พบคู่ ระบบยกเลิกให้อัตโนมัติ",
      "• เมื่อพบคู่ จะสร้างห้องเสียงส่วนตัวให้คุยได้ไม่จำกัดเวลา",
      "• หากฝ่ายใดออกจากห้อง ระบบจะแจ้งอีกฝ่ายและปิดห้อง",
      "",
      "หมายเหตุ: กรุณาเข้าห้องเสียงใดก็ได้ก่อนเริ่มค้นหา เพื่อให้บอทย้ายคุณไปยังห้องคู่ได้"
    ].join("\n"))
    .setFooter({ text: "ON KING COMMUNITY • Sweet Match" });
}

async function restoreActiveMatches(guild) {
  const categoryId = sweetSettings[guild.id]?.categoryChannelId;
  if (!categoryId) return;
  const category = guild.channels.cache.get(categoryId)
    || await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return;

  for (const channel of category.children.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice || !channel.name.startsWith("sweet-")) continue;
    const channelMatch = channel.name.match(/^sweet-(\\d{15,25})-(\\d{15,25})$/);
    if (!channelMatch) continue;
    const ids = [channelMatch[1], channelMatch[2]];

    if (channel.members.size === 0) {
      await channel.delete("ล้างห้อง Sweet Match ที่ไม่มีสมาชิกหลังบอทเริ่มทำงาน").catch(() => {});
      continue;
    }

    activeMatches.set(channel.id, { guildId: guild.id, userIds: ids, ended: false });
    for (const id of ids) activeUsers.set(id, channel.id);

    const missingId = ids.find(id => !channel.members.has(id));
    if (missingId) {
      await endMatch(
        channel.id,
        "💛 อีกฝ่ายออกจากห้องระหว่างที่บอทหยุดทำงาน การจับคู่จึงสิ้นสุดลงครับ",
        missingId
      );
    }
  }
}

async function sendPanel(channel) {
  await channel.send({
    embeds: [createPanelEmbed()],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sm_start")
          .setLabel("เริ่มจับคู่")
          .setEmoji("💛")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
}

async function removeFromQueue(guildId, userId) {
  const queue = getQueue(guildId);
  const index = queue.findIndex(entry => entry.userId === userId);
  if (index < 0) return null;
  const [entry] = queue.splice(index, 1);
  clearTimeout(entry.timer);
  return entry;
}

async function endMatch(channelId, reason, leaverId = null) {
  const match = activeMatches.get(channelId);
  if (!match || match.ended) return;
  match.ended = true;
  activeMatches.delete(channelId);

  for (const userId of match.userIds) activeUsers.delete(userId);

  const otherIds = leaverId
    ? match.userIds.filter(id => id !== leaverId)
    : match.userIds;

  const guild = client.guilds.cache.get(match.guildId);
  for (const userId of otherIds) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(reason);
    } catch (error) {
      console.warn(`ส่ง DM แจ้งผล Sweet Match ให้ ${userId} ไม่สำเร็จ:`, error.message);
    }
  }

  if (guild) {
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.delete("จบการจับคู่ ON KING SWEET MATCH").catch(error => {
        console.error("ลบห้อง Sweet Match ไม่สำเร็จ:", error.message);
      });
    }
  }
}

async function tryMatch(guild, newEntry) {
  const queue = getQueue(guild.id);
  const partnerIndex = queue.findIndex(entry =>
    entry.userId !== newEntry.userId && isCompatible(newEntry, entry)
  );
  if (partnerIndex < 0) return false;

  const [partner] = queue.splice(partnerIndex, 1);
  clearTimeout(partner.timer);
  const current = await removeFromQueue(guild.id, newEntry.userId);
  if (!current) {
    queue.push(partner);
    return false;
  }

  const firstMember = await guild.members.fetch(current.userId).catch(() => null);
  const secondMember = await guild.members.fetch(partner.userId).catch(() => null);

  if (!firstMember || !secondMember || !firstMember.voice.channel || !secondMember.voice.channel) {
    const message = "การจับคู่ยกเลิก เพราะสมาชิกคนใดคนหนึ่งไม่ได้อยู่ในห้องเสียงแล้ว กรุณาเข้าห้องเสียงและเริ่มใหม่";
    await current.interaction.editReply({ content: message, components: [] }).catch(() => {});
    await partner.interaction.editReply({ content: message, components: [] }).catch(() => {});
    return true;
  }

  const categoryId = sweetSettings[guild.id]?.categoryChannelId;
  const category = categoryId ? guild.channels.cache.get(categoryId) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    const message = "ยังไม่ได้ตั้งค่าหมวดหมู่ห้อง Sweet Match หรือหมวดหมู่ถูกลบแล้ว กรุณาแจ้งแอดมิน";
    await current.interaction.editReply({ content: message, components: [] }).catch(() => {});
    await partner.interaction.editReply({ content: message, components: [] }).catch(() => {});
    return true;
  }

  let voiceChannel;
  try {
    voiceChannel = await guild.channels.create({
      name: `sweet-${current.userId}-${partner.userId}`,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: 2,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers
          ]
        },
        {
          id: current.userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.Stream
          ]
        },
        {
          id: partner.userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.Stream
          ]
        }
      ],
      reason: "สร้างห้องส่วนตัวสำหรับ ON KING SWEET MATCH"
    });

    activeMatches.set(voiceChannel.id, {
      guildId: guild.id,
      userIds: [current.userId, partner.userId],
      ended: false
    });
    activeUsers.set(current.userId, voiceChannel.id);
    activeUsers.set(partner.userId, voiceChannel.id);

    await firstMember.voice.setChannel(voiceChannel);
    await secondMember.voice.setChannel(voiceChannel);

    await current.interaction.editReply({
      content: `💛 พบคู่แล้ว! ย้ายคุณเข้าห้องเสียงส่วนตัว ${voiceChannel} เรียบร้อย คุยกันได้ไม่จำกัดเวลาครับ`,
      components: []
    }).catch(() => {});
    await partner.interaction.editReply({
      content: `💛 พบคู่แล้ว! ย้ายคุณเข้าห้องเสียงส่วนตัว ${voiceChannel} เรียบร้อย คุยกันได้ไม่จำกัดเวลาครับ`,
      components: []
    }).catch(() => {});
    return true;
  } catch (error) {
    console.error("สร้างห้องหรือย้ายสมาชิก Sweet Match ไม่สำเร็จ:", error);
    if (voiceChannel) await voiceChannel.delete("ยกเลิกการสร้างห้อง Sweet Match").catch(() => {});
    activeMatches.delete(voiceChannel?.id);
    activeUsers.delete(current.userId);
    activeUsers.delete(partner.userId);
    const message = "จับคู่ได้แล้วแต่สร้างห้องเสียงไม่สำเร็จ กรุณาตรวจสอบสิทธิ์บอท (Manage Channels และ Move Members) แล้วลองใหม่";
    await current.interaction.editReply({ content: message, components: [] }).catch(() => {});
    await partner.interaction.editReply({ content: message, components: [] }).catch(() => {});
    return true;
  }
}

async function beginSearch(interaction, selection) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: "ระบบนี้ใช้งานได้ภายในเซิร์ฟเวอร์ ON KING เท่านั้น", components: [] });
    return;
  }
  const searchingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!searchingMember?.voice?.channelId) {
    await interaction.editReply({
      content: "กรุณาเข้าห้องเสียงใดก็ได้ในเซิร์ฟเวอร์ก่อน แล้วกดเริ่มค้นหาอีกครั้งครับ",
      components: []
    });
    return;
  }
  if (activeUsers.has(interaction.user.id)) {
    await interaction.editReply({ content: "คุณกำลังอยู่ในห้อง Sweet Match อยู่แล้วครับ", components: [] });
    return;
  }

  const existing = await removeFromQueue(guild.id, interaction.user.id);
  if (existing) {
    await interaction.editReply({ content: "คุณกำลังค้นหาคู่อยู่แล้วครับ", components: [] });
    return;
  }

  const entry = {
    userId: interaction.user.id,
    gender: selection.gender,
    preference: selection.preference,
    interaction,
    timer: null
  };

  const queue = getQueue(guild.id);
  queue.push(entry);
  await interaction.editReply({
    content: "🔎 กำลังค้นหาคู่ที่ตรงกันทั้งสองฝ่าย... ระบบจะยกเลิกอัตโนมัติเมื่อครบ 3 นาที",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("sm_cancel")
          .setLabel("ยกเลิกการค้นหา")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  });

  entry.timer = setTimeout(async () => {
    const removed = await removeFromQueue(guild.id, entry.userId);
    if (!removed) return;
    await entry.interaction.editReply({
      content: "⌛ ครบ 3 นาทีแล้วยังไม่พบคู่ที่ตรงกัน ระบบยกเลิกการค้นหาให้แล้วครับ",
      components: []
    }).catch(() => {});
  }, SEARCH_TIMEOUT_MS);

  await tryMatch(guild, entry);
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("ตรวจสอบว่า ON KING BOT ทำงานปกติหรือไม่")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("sweetmatch")
    .setDescription("ตั้งค่าและจัดการ ON KING SWEET MATCH")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName("setup")
        .setDescription("ตั้งค่าห้องแผงจับคู่และหมวดหมู่ห้องเสียง")
        .addChannelOption(option =>
          option
            .setName("panel_channel")
            .setDescription("ห้องข้อความสำหรับวางปุ่มเริ่มจับคู่")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName("voice_category")
            .setDescription("หมวดหมู่ที่จะใช้สร้างห้องเสียงส่วนตัว")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName("panel")
        .setDescription("ส่งแผงปุ่มเริ่มจับคู่ไปยังห้องที่ตั้งค่าไว้")
    )
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(token);

async function registerGuildCommands(guildId, guildName = guildId) {
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guildId),
      { body: commands }
    );
    console.log(`ลงทะเบียนคำสั่งสำเร็จ: ${guildName}`);
  } catch (error) {
    console.error(`ลงทะเบียนคำสั่งไม่สำเร็จ (${guildName}):`, error);
  }
}

function memberToPayload(member) {
  const guild = member.guild;
  const roles = member.roles.cache
    .filter(role => role.id !== guild.id)
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      icon: typeof role.iconURL === "function" ? role.iconURL({ size: 64 }) : null
    }));

  return {
    discord_user_id: member.user.id,
    username: member.user.username,
    global_name: member.user.globalName || null,
    display_name: member.displayName || member.user.username,
    nickname: member.nickname || null,
    avatar_url: member.user.displayAvatarURL({ extension: "png", size: 256 }),
    is_bot: member.user.bot,
    is_in_guild: true,
    role_ids: roles.map(role => role.id),
    roles,
    joined_at: member.joinedAt ? member.joinedAt.toISOString() : null
  };
}

async function sendMemberBatch(guildId, members) {
  if (!syncSecret) {
    console.warn("ยังไม่ได้ตั้ง DISCORD_SYNC_SECRET ใน Hostrix — ข้ามการซิงก์ข้อมูล");
    return false;
  }

  try {
    const response = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-onking-sync-secret": syncSecret
      },
      body: JSON.stringify({
        guild_id: guildId,
        members: members.map(memberToPayload)
      })
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("ซิงก์สมาชิกไม่สำเร็จ:", response.status, details.slice(0, 300));
      return false;
    }

    const result = await response.json();
    console.log(`ซิงก์สมาชิกสำเร็จ ${result.received} คน`);
    return true;
  } catch (error) {
    console.error("เชื่อมต่อ Supabase ไม่สำเร็จ:", error.message);
    return false;
  }
}

async function syncAllGuildMembers(guild) {
  if (!syncSecret) {
    console.warn("ยังไม่ได้ตั้ง DISCORD_SYNC_SECRET — ยังไม่เริ่มซิงก์สมาชิก");
    return;
  }

  try {
    console.log(`กำลังดึงรายชื่อสมาชิกจาก ${guild.name}...`);
    const members = await guild.members.fetch();
    const list = [...members.values()];
    console.log(`พบสมาชิก ${list.length} คน กำลังส่งข้อมูลไป Supabase...`);

    const batchSize = 100;
    for (let i = 0; i < list.length; i += batchSize) {
      const ok = await sendMemberBatch(guild.id, list.slice(i, i + batchSize));
      if (!ok) break;
      if (i + batchSize < list.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } catch (error) {
    console.error("ดึงหรือซิงก์รายชื่อสมาชิกไม่สำเร็จ:", error.message);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ON KING BOT ONLINE: ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [{ name: "ON KING COMMUNITY", type: ActivityType.Watching }],
    status: "online"
  });

  const guilds = [...readyClient.guilds.cache.values()];
  if (guilds.length === 0) {
    console.warn("บอทยังไม่พบเซิร์ฟเวอร์ Discord ที่เข้าร่วม");
    return;
  }

  for (const guild of guilds) {
    await restoreActiveMatches(guild);
    await registerGuildCommands(guild.id, guild.name);
    await syncAllGuildMembers(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  if (client.user) {
    await registerGuildCommands(guild.id, guild.name);
    await syncAllGuildMembers(guild);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  await sendMemberBatch(member.guild.id, [member]);
});

client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
  await sendMemberBatch(newMember.guild.id, [newMember]);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const queued = await removeFromQueue(member.guild.id, member.id);
  if (queued) {
    await queued.interaction.editReply({
      content: "การค้นหาถูกยกเลิก เพราะสมาชิกออกจากเซิร์ฟเวอร์ครับ",
      components: []
    }).catch(() => {});
  }

  for (const [channelId, match] of activeMatches.entries()) {
    if (match.guildId === member.guild.id && match.userIds.includes(member.id)) {
      await endMatch(
        channelId,
        "💛 อีกฝ่ายออกจากเซิร์ฟเวอร์ การจับคู่ ON KING SWEET MATCH จึงสิ้นสุดลงครับ",
        member.id
      );
    }
  }

  if (!syncSecret) return;
  const payload = memberToPayload(member);
  payload.is_in_guild = false;

  try {
    const response = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-onking-sync-secret": syncSecret
      },
      body: JSON.stringify({
        guild_id: member.guild.id,
        members: [payload]
      })
    });
    if (!response.ok) {
      console.error("อัปเดตสถานะสมาชิกที่ออกจากเซิร์ฟเวอร์ไม่สำเร็จ:", response.status);
    }
  } catch (error) {
    console.error("ส่งสถานะสมาชิกที่ออกจากเซิร์ฟเวอร์ไม่สำเร็จ:", error.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ping") {
        const latency = Math.round(client.ws.ping);
        await interaction.reply(
          `🏓 Pong! ON KING BOT ทำงานปกติ\nWebSocket Latency: ${latency} ms`
        );
        return;
      }

      if (interaction.commandName === "sweetmatch") {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "setup") {
          const panelChannel = interaction.options.getChannel("panel_channel");
          const category = interaction.options.getChannel("voice_category");
          const me = await interaction.guild.members.fetchMe();
          const panelPermissions = panelChannel.permissionsFor(me);
          const categoryPermissions = category.permissionsFor(me);

          if (!panelPermissions?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
          ])) {
            await interaction.reply({
              content: "บอทต้องมีสิทธิ์ View Channel, Send Messages และ Embed Links ในห้องแผงจับคู่ครับ",
              ephemeral: true
            });
            return;
          }

          if (!categoryPermissions?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers
          ])) {
            await interaction.reply({
              content: "บอทต้องมีสิทธิ์ View Channel, Manage Channels และ Move Members ในหมวดหมู่ห้องเสียงครับ",
              ephemeral: true
            });
            return;
          }

          sweetSettings[interaction.guildId] = {
            panelChannelId: panelChannel.id,
            categoryChannelId: category.id
          };

          try {
            saveSweetSettings();
          } catch (error) {
            console.error("บันทึกการตั้งค่า Sweet Match ไม่สำเร็จ:", error);
            await interaction.reply({
              content: "บันทึกการตั้งค่าไม่ได้ กรุณาตรวจสอบว่า Hostrix อนุญาตให้บอทเขียนไฟล์ในโฟลเดอร์โปรเจกต์",
              ephemeral: true
            });
            return;
          }

          await interaction.reply({
            content: `บันทึกการตั้งค่าแล้วครับ\nห้องแผงจับคู่: ${panelChannel}\nหมวดหมู่ห้องเสียง: ${category}\nกำลังส่งแผงปุ่มจับคู่...`,
            ephemeral: true
          });
          await sendPanel(panelChannel);
          return;
        }

        if (subcommand === "panel") {
          const panelChannelId = sweetSettings[interaction.guildId]?.panelChannelId;
          const panelChannel = panelChannelId
            ? interaction.guild.channels.cache.get(panelChannelId)
              || await interaction.guild.channels.fetch(panelChannelId).catch(() => null)
            : null;

          if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
            await interaction.reply({
              content: "ยังไม่ได้ตั้งค่าห้องแผงจับคู่ ใช้ /sweetmatch setup ก่อนครับ",
              ephemeral: true
            });
            return;
          }

          await sendPanel(panelChannel);
          await interaction.reply({ content: `ส่งแผงจับคู่ไปที่ ${panelChannel} แล้วครับ`, ephemeral: true });
          return;
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "sm_start") {
        if (!interaction.inGuild()) {
          await interaction.reply({ content: "ใช้ได้เฉพาะในเซิร์ฟเวอร์ครับ", ephemeral: true });
          return;
        }
        const clickingMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!clickingMember?.voice?.channelId) {
          await interaction.reply({
            content: "กรุณาเข้าห้องเสียงใดก็ได้ก่อนเริ่มจับคู่ครับ",
            ephemeral: true
          });
          return;
        }
        const current = selections.get(interaction.user.id) || {};
        selections.set(interaction.user.id, current);
        await interaction.reply({
          content: "เลือกเพศของตัวเองและเพศที่ต้องการพบครับ",
          components: selectionComponents(interaction.user.id, current),
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === "sm_submit") {
        const selection = selections.get(interaction.user.id);
        if (!selection?.gender || !selection?.preference) {
          await interaction.reply({ content: "กรุณาเลือกข้อมูลให้ครบทั้งสองรายการก่อนครับ", ephemeral: true });
          return;
        }
        if (activeUsers.has(interaction.user.id)) {
          await interaction.reply({ content: "คุณกำลังอยู่ในห้อง Sweet Match อยู่แล้วครับ", ephemeral: true });
          return;
        }
        await interaction.deferUpdate();
        await beginSearch(interaction, selection);
        selections.delete(interaction.user.id);
        return;
      }

      if (interaction.customId === "sm_cancel") {
        const removed = await removeFromQueue(interaction.guildId, interaction.user.id);
        await interaction.update({
          content: removed ? "ยกเลิกการค้นหาคู่เรียบร้อยแล้วครับ" : "ตอนนี้คุณไม่ได้อยู่ในคิวค้นหาครับ",
          components: []
        });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      const [kind, ownerId] = interaction.customId.split(":");
      if (!["sm_gender", "sm_preference"].includes(kind)) return;
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: "เมนูนี้เป็นของสมาชิกอีกคนครับ", ephemeral: true });
        return;
      }
      const selection = selections.get(ownerId) || {};
      if (kind === "sm_gender") selection.gender = interaction.values[0];
      if (kind === "sm_preference") selection.preference = interaction.values[0];
      selections.set(ownerId, selection);
      await interaction.update({
        content: "เลือกเพศของตัวเองและเพศที่ต้องการพบครับ",
        components: selectionComponents(ownerId, selection)
      });
    }
  } catch (error) {
    console.error("Sweet Match interaction error:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "ระบบ Sweet Match ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งครับ",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!oldState.channelId || oldState.channelId === newState.channelId) return;
  const match = activeMatches.get(oldState.channelId);
  if (!match || !match.userIds.includes(oldState.id)) return;
  await endMatch(
    oldState.channelId,
    "💛 อีกฝ่ายออกจากห้องเสียงแล้ว การจับคู่ ON KING SWEET MATCH จึงสิ้นสุดลงครับ",
    oldState.id
  );
});

client.on(Events.ChannelDelete, (channel) => {
  if (activeMatches.has(channel.id)) {
    const match = activeMatches.get(channel.id);
    activeMatches.delete(channel.id);
    for (const userId of match.userIds) activeUsers.delete(userId);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

client.login(token).catch((error) => {
  console.error("เข้าสู่ระบบ Discord ไม่สำเร็จ:", error.message);
  process.exit(1);
});
