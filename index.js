
const {
  Client,
  GatewayIntentBits,
  ActivityType
} = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error("ไม่พบ DISCORD_BOT_TOKEN");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

client.once("ready", () => {
  console.log(`ON KING BOT ONLINE: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "ON KING COMMUNITY",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });
});

client.on("error", console.error);

client.login(token).catch((error) => {
  console.error("เข้าสู่ระบบ Discord ไม่สำเร็จ:", error.message);
  process.exit(1);
});
