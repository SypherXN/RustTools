import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { env } from "./config.js";

async function main() {
  if (!env.botToken || !env.guildId || !env.clientId) {
    throw new Error("DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required");
  }

  const rest = new REST({ version: "10" }).setToken(env.botToken);

  await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), {
    body: commands,
  });

  console.log(`Registered ${commands.length} slash commands for guild ${env.guildId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
