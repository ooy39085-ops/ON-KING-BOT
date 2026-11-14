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

if (!token) {
  console.error("ไม่พบ DISCORD_BOT_TOKEN ใน Environment Variables");
  process.exit(1);
}

const client = new Client({
  // Slash commands and guild events do not require privileged intents.
  intents: [GatewayIntentBits.Guilds]
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
  }
});

client.on(Events.GuildCreate, async (guild) => {
  if (client.user) {
    await registerGuildCommands(guild.id, guild.name);
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
