
const Discord = require('discord.js');
const config = require('./config.json');

async function main() {
    // Build commands
    const builders = [
        new Discord.SlashCommandBuilder()
            .setName('help')
            .setDescription('Learn about the bot'),
        new Discord.SlashCommandBuilder()
            .setName('stats')
            .setDescription('Get usage statistics')
            .addUserOption(option => option
                .setName(`user`)
                .setDescription(`Get stats for this user`)
            ),
        new Discord.SlashCommandBuilder()
            .setName('purge')
            .setDescription('Purge your interactions from the database'),
        new Discord.SlashCommandBuilder()
            .setName('fullpurge')
            .setDescription('Purge all interactions from the database'),
        new Discord.SlashCommandBuilder()
            .setName('invite')
            .setDescription('Get an invitation link for the bot'),
        new Discord.SlashCommandBuilder()
            .setName('users')
            .setDescription('Manage bot access')
            .addSubcommand(subcmd => subcmd
                .setName(`allow`)
                .setDescription(`Allow a user to use the bot`)
                .addUserOption(option => option
                    .setName(`user`)
                    .setDescription(`The user to allow`)
                    .setRequired(true)
                ))
            .addSubcommand(subcmd => subcmd
                .setName(`block`)
                .setDescription(`Block a user from using the bot`)
                .addUserOption(option => option
                    .setName(`user`)
                    .setDescription(`The user to block`)
                    .setRequired(true)
                ))
            .addSubcommand(subcmd => subcmd
                .setName(`unset`)
                .setDescription(`Remove a user from the allow/block list`)
                .addUserOption(option => option
                    .setName(`user`)
                    .setDescription(`The user to unset`)
                    .setRequired(true)
                ))
            .addSubcommand(subcmd => subcmd
                .setName(`wipe`)
                .setDescription(`Wipe the allow/block list`))
    ];
    // Register slash commands with Discord
    const api = new Discord.REST({ version: 10 }).setToken(config.discord.token);
    await api.put(Discord.Routes.applicationCommands(config.discord.id), {
        body: builders
    });
    console.log(`Registered slash commands`);
}
main();