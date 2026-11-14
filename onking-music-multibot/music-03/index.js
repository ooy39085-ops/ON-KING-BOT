const { Client, GatewayIntentBits, Events } = require("discord.js");
const {
  musicCommands,
  handleMusicInteraction,
  restoreMusicConnections
} = require("./music");

const SLOT = "03";
const TOKEN_NAME = "ONKING_MUSIC_" + SLOT + "_TOKEN";
const token = process.env[TOKEN_NAME];

if (!token) {
  console.error("ไม่พบ Environment Variable: " + TOKEN_NAME);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once(Events.ClientReady, async readyClient => {
  console.log("ON KING MUSIC 03 ONLINE: " + readyClient.user.tag);

  try {
    await readyClient.application.commands.set(musicCommands);
    console.log("ลงทะเบียนคำสั่ง ON KING MUSIC 03 สำเร็จ");
  } catch (error) {
    console.error("ลงทะเบียนคำสั่งไม่สำเร็จ:", error);
  }

  await restoreMusicConnections(readyClient);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    await handleMusicInteraction(interaction);
  } catch (error) {
    console.error("ON KING MUSIC 03 interaction error:", error);
    const message = "เกิดข้อผิดพลาดในการทำงานของบอทเพลงครับ";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
    }
  }
});

client.login(token).catch(error => {
  console.error("เข้าสู่ระบบ ON KING MUSIC 03 ไม่สำเร็จ:", error);
  process.exit(1);
});
