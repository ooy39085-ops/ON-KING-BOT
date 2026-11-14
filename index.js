const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const syncSecret = process.env.DISCORD_SYNC_SECRET;
const supabaseUrl = (process.env.SUPABASE_URL || "https://alfaddeavpefqobspvxt.supabase.co").replace(/\/$/, "");
const syncUrl = `${supabaseUrl}/functions/v1/discord-member-sync`;

if (!token) {
  console.error("ไม่พบ DISCORD_BOT_TOKEN ใน Environment Variables");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("ตรวจสอบว่า ON KING BOT ทำงานปกติหรือไม่")
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
    activities: [
      {
        name: "ON KING COMMUNITY",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  const guilds = [...readyClient.guilds.cache.values()];

  if (guilds.length === 0) {
    console.warn("บอทยังไม่พบเซิร์ฟเวอร์ Discord ที่เข้าร่วม");
    return;
  }

  for (const guild of guilds) {
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
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    const latency = Math.round(client.ws.ping);
    await interaction.reply(
      `🏓 Pong! ON KING BOT ทำงานปกติ\nWebSocket Latency: ${latency} ms`
    );
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
