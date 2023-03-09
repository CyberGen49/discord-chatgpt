
const Discord = require('discord.js');
const config = require('./config.json');

async function main() {
    // Build commands
    const builders = [
        new Discord.SlashCommandBuilder()
            .setName('stats')
            .setDescription('Get usage statistics'),
        new Discord.SlashCommandBuilder()
            .setName('purge')
            .setDescription('Purge your interactions from the database')
    ];
    // Register slash commands with Discord
    const api = new Discord.REST({ version: 10 }).setToken(config.discord.token);
    await api.put(Discord.Routes.applicationCommands(config.discord.id), {
        body: builders
    });
    console.log(`Registered slash commands`);
}
main();