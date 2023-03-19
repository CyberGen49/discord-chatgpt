
const fs = require('fs');
const sqlite3 = require('better-sqlite3');
const dayjs = require('dayjs');
const clc = require('cli-color');
const tokens = require('gpt-3-encoder');
const axios = require('axios');
const Discord = require('discord.js');
const express = require('express');
const logger = require('cyber-express-logger');
const config = require('./config.json');

const stats = fs.existsSync('./stats.json') ? require('./stats.json') : {
    messages: 0,
    tokens: 0,
    users: {},
    months: {}
};
const users = fs.existsSync('./users.json') ? require('./users.json') : {
    allowed: [],
    blocked: []
};

const log = (...args) => console.log(clc.white(`[${dayjs().format('YYYY-MM-DD HH:mm:ss')}]`), ...args);
const writeStats = () => {
    fs.writeFileSync('./stats.json', JSON.stringify(stats));
    log(`Updated stats file`);
}
const writeUsers = () => {
    fs.writeFileSync('./users.json', JSON.stringify(users));
    log(`Updated users file`);
}
const countTokens = text => tokens.encode(text).length;

const bot = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.MessageContent
    ],
    partials: [ Discord.Partials.Channel ]
});

bot.once('ready', () => {
    log(`Logged in as ${bot.user.username}#${bot.user.discriminator}!`);
    const setStatus = () => bot.user.setActivity('your questions', { type: Discord.ActivityType.Listening });
    setInterval(setStatus, (1000*60*60));
});
const userIsGenerating = {};
const channelLastActive = {};
bot.on('messageCreate', async msg => {
    const state = clc.cyanBright(`[${msg.id}]`);
    const now = Date.now();
    channelLastActive[msg.channel.id] = now;
    if (msg.author.bot) return;
    if (msg.guild && !msg.mentions.has(bot.user.id)) return;
    const sendTyping = async() => {
        log(state, `Typing in channel ${msg.channel.id}`);
        await msg.channel.sendTyping();
    }
    const sendReply = async(content) => {
        try {
            const textFileName = `response-${msg.id}.txt`;
            let shouldSendTextFile = false;
            if (content.length > 1999) {
                log(state, `Sending response as ${textFileName}`);
                fs.writeFileSync(textFileName, content);
                shouldSendTextFile = true;
                content = `This response was too long to send as a message, so here it is in a text file:`;
            }
            let replyMethod = data => msg.channel.send(data);
            if (now !== channelLastActive[msg.channel.id]) {
                replyMethod = data => msg.reply(data);
            }
            const newMsg = await replyMethod({
                content: content,
                files: shouldSendTextFile ? [ textFileName ] : []
            });
            log(state, `Sent response, message ID ${newMsg.id}`);
            if (shouldSendTextFile)
                fs.rmSync(textFileName);
            return newMsg;
        } catch (error) {
            log(state, error);
            return null;
        }
    }
    if (!config.public_usage && !users.allowed.includes(msg.author.id)) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} isn't allowed`);
        return sendReply(`Only certain users are allowed to talk to me right now. If you want to be added to the list, contact <@${config.discord.owner_id}>.`);
    }
    if (users.blocked.includes(msg.author.id)) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} is blocked`);
        return sendReply(`You're blocked from using me!`);
    }
    if (userIsGenerating[msg.author.id]) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} tried to generate while generating`);
        return sendReply(`One message at a time!`);
    }
    const input = msg.content.split(' ').filter(segment => !segment.match(/<(@|#)(\d+)>/)).join(' ').trim();
    if (!input) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} made an empty ping`);
        return sendReply(`Hi! Ping me again with a message and I'll try my best to answer it!`);
    }
    for (const prefix of config.ignore_prefixes) {
        if (input.startsWith(prefix)) {
            return log(state, `User ${msg.author.username}#${msg.author.discriminator} used an ignored prefix`);
        }
    }
    if (countTokens(input) > config.max_input_tokens) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} sent a message that exceeded config.max_input_tokens`);
        return sendReply(`That message is too long for me to handle! Can you make it shorter?`);
    }
    const getChatResponse = async(messages = []) => {
        const placeholders = {
            user_username: msg.author.username,
            user_nickname: msg.guild ? msg.guild.members.cache.get(msg.author.id)?.displayName : msg.author.username,
            bot_username: bot.user.username
        }
        const systemPrompt = config.system_prompt.replace(/\{(\w+)\}/g, (match, key) => placeholders[key]);
        messages = [
            { role: 'system', content: systemPrompt },
            ...messages
        ];
        let tentativeTokenCount = 0;
        for (const message of messages) {
            const tokenCount = countTokens(message.content);
            tentativeTokenCount += tokenCount;
        }
        tentativeTokenCount = countTokens(JSON.stringify(messages));
        try {
            log(state, `Making OpenAI request of approx. ${tentativeTokenCount} tokens`);
            const res = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo',
                messages: messages,
                max_tokens: config.max_output_tokens
            }, {
                headers: { Authorization: `Bearer ${config.openai.secret}` },
                validateStatus: status => true
            });
            if (!res.data || res.data.error) {
                log(state, `OpenAI request failed:`, res.data || '[No response data]');
                return res.data.error ? { error: res.data.error } : null;
            }
            const gpt = {
                reply: res?.data?.choices[0].message.content || null,
                count_tokens: res?.data?.usage.total_tokens
            };
            log(state, `Received OpenAI response of ${gpt.count_tokens} tokens`);
            return gpt;
        } catch (error) {
            log(state, error);
            return null;
        }
    };
    await sendTyping();
    const db = sqlite3('./main.db');
    const typingInterval = setInterval(sendTyping, 3000);
    try {
        let messages = [{ role: 'user', content: input }];
        if (msg.type == Discord.MessageType.Reply) {
            const srcMsg = msg.channel.messages.cache.get(msg.reference.messageId);
            const msgType = (srcMsg.author.id == bot.user.id) ? 'assistant' : 'user';
            messages = [
                { role: msgType, content: srcMsg.content },
                ...messages
            ];
            if (msgType == 'assistant') {
                const lastMsg = db.prepare(`SELECT * FROM messages WHERE channel_id = ? AND output_msg_id = ?`).get(msg.channel.id, srcMsg.id);
                if (lastMsg) {
                    messages = [
                        { role: 'user', content: lastMsg.input },
                        ...messages
                    ];
                    log(state, `Using replied-to saved input and output as context`);
                } else {
                    log(state, `Using replied-to user message as context (couldn't find saved message)`);
                }
            } else {
                log(state, `Using replied-to user message as context`);
            }
        } else if (!msg.guild) {
            const lastMsg = db.prepare(`SELECT * FROM messages WHERE channel_id = ? ORDER BY time_created DESC LIMIT 1`).get(msg.channel.id);
            if (lastMsg) {
                messages = [
                    { role: 'user', content: lastMsg.input },
                    { role: 'assistant', content: lastMsg.output },
                    ...messages
                ];
                log(state, `Using previous input and output as context`);
            }
        }
        userIsGenerating[msg.author.id] = true;
        const gpt = await getChatResponse(messages, msg.author);
        if (!gpt || gpt.error) {
            await sendReply(`Something went wrong while contacting OpenAI. Please try again later.${gpt.error ? `\n\`${gpt.error.code}\` ${gpt.error.message}`:''}`);
            throw new Error(`Bad response from OpenAI, error message sent`);
        }
        gpt.reply = gpt.reply
            .replace(/([@])/g, '\\$1')
            .replace(/```\n\n/g, '```')
            .replace(/\n\n```/g, '\n```');
        db.prepare(`INSERT INTO messages (time_created, user_id, channel_id, input_msg_id, input, output, count_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), msg.author.id, msg.channel.id, msg.id, input, gpt.reply, gpt.count_tokens);
        const month = dayjs().format('YYYY-MM');
        // Initialize stats object
        stats.users[msg.author.id] = stats.users[msg.author.id] || {
            interactions: 0,
            tokens: 0
        };
        if (!stats.months) stats.months = {};
        if (!stats.months[month]) stats.months[month] = {
            totalInteractions: 0,
            totalTokens: 0,
            users: {}
        };
        if (!stats.months[month].users[msg.author.id]) {
            stats.months[month].users[msg.author.id] = {
                interactions: 0,
                tokens: 0
            }
        }
        // Update all-time stats
        stats.totalInteractions++;
        stats.totalTokens += gpt.count_tokens;
        stats.users[msg.author.id].interactions++;
        stats.users[msg.author.id].tokens += gpt.count_tokens;
        // Update monthly stats
        stats.months[month].totalInteractions++;
        stats.months[month].totalTokens += gpt.count_tokens;
        stats.months[month].users[msg.author.id].interactions++;
        stats.months[month].users[msg.author.id].tokens += gpt.count_tokens;
        writeStats();
        clearInterval(typingInterval);
        let outputMsg = await sendReply(gpt.reply);
        if (outputMsg && outputMsg.id) {
            db.prepare(`UPDATE messages SET output_msg_id = ? WHERE input_msg_id = ?`).run(outputMsg.id, msg.id);
        }
    } catch (error) {
        log(state, `Failed to send message`, error);
        try {
            await sendReply(`Sorry, something went wrong while replying!`);
        } catch (error) {
            log(state, `Failed to send error message`, error);
        }
        clearInterval(typingInterval);
    }
    db.close();
    userIsGenerating[msg.author.id] = false;
});

/**
 * @callback CommandHandler
 * @param {Discord.CommandInteraction} interaction
 */
const commands = {
    /** @type {CommandHandler} */
    help: async(interaction) => {
        await interaction.reply(`I'm a bot who shares the same language model as ChatGPT! Send me a DM or ping me in a server and I'll be happy to assist you to the best of my abilities. In DMs, I'm able to remember your previous message and my response to it, and in DMs and servers, you can reply to any message (mine or someone else's) and I'll use it as context.\n\nNote that we save your interactions (inputs and outputs) to a database to provide conversation history. You can use \`/purge\` to remove all of that content at any time. OpenAI may also hang on to your inputs for a while, so see [their privacy policy](<https://openai.com/policies/privacy-policy>) for more details.\n\nInterested in the innerworkings or want to run me for yourself? [Read my source code on GitHub](<https://github.com/CyberGen49/discord-chatgpt>)!`);
        log(`${interaction.user.username}#${interaction.user.discriminator} used /help`);
    },
    /** @type {CommandHandler} */
    stats: async(interaction) => {
        const user = interaction.options.getUser('user') || interaction.user;
        const totalInteractions = stats.totalInteractions || 0;
        const totalTokens = stats.totalTokens || 0;
        const totalCost = totalTokens*config.usd_per_token;
        const totalMyInteractions = stats.users[user.id]?.interactions || 0;
        const totalMyTokens = stats.users[user.id]?.tokens || 0;
        const totalMyCost = totalMyTokens*config.usd_per_token;
        const month = dayjs().format('YYYY-MM');
        const monthInteractions = stats.months?.[month]?.totalInteractions || 0;
        const monthTokens = stats.months?.[month]?.totalTokens || 0;
        const monthCost = monthTokens*config.usd_per_token;
        const monthMyInteractions = stats.months?.[month]?.users?.[user.id]?.interactions || 0;
        const monthMyTokens = stats.months?.[month]?.users?.[user.id]?.tokens || 0;
        const monthMyCost = monthMyTokens*config.usd_per_token;
        const allTimeEmbed = new Discord.EmbedBuilder()
            .setTitle(`Global usage stats`)
            .setColor(0x3789c8)
            .addFields([
                {
                    name: `All-time`,
                    value: [
                        `${totalInteractions.toLocaleString()} messages`,
                        `${totalTokens.toLocaleString()} tokens`,
                        `\$${totalCost.toFixed(2)} used`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `This month`,
                    value: [
                        `${monthInteractions.toLocaleString()} messages`,
                        `${monthTokens.toLocaleString()} tokens`,
                        `\$${monthCost.toFixed(2)} used`
                    ].join('\n'),
                    inline: true
                }
            ]);
        const userEmbed = new Discord.EmbedBuilder()
            .setTitle(`${(interaction.user.id == user.id) ? 'My' : `${user.username}'s`} usage stats`)
            .setColor(0x3789c8)
            .addFields([
                {
                    name: `All-time`,
                    value: [
                        `${totalMyInteractions.toLocaleString()} messages`,
                        `${totalMyTokens.toLocaleString()} tokens`,
                        `\$${totalMyCost.toFixed(2)} used`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `This month`,
                    value: [
                        `${monthMyInteractions.toLocaleString()} messages`,
                        `${monthMyTokens.toLocaleString()} tokens`,
                        `\$${monthMyCost.toFixed(2)} used`
                    ].join('\n'),
                    inline: true
                }
            ]);
        const embeds = (interaction.user.id == user.id) ? [allTimeEmbed, userEmbed] : [userEmbed];
        await interaction.reply({
            embeds: embeds,
            ephemeral: true
        });
        log(`${interaction.user.username}#${interaction.user.discriminator} got stats for ${user.username}#${user.discriminator}`);
    },
    /** @type {CommandHandler} */
    purge: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const db = sqlite3('./main.db');
        const messages = db.prepare(`SELECT * FROM messages WHERE user_id = ?`).all(interaction.user.id);
        for (const message of messages) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(message.input_msg_id);
        }
        db.close();
        log(`${interaction.user.username}#${interaction.user.discriminator} purged their saved messages`);
        interaction.editReply(`Purged ${messages.length} interactions from the database. You won't have conversation history until you interact again. This won't affect your statistics shown with **/stats**.\nNote that OpenAI may retain your interactions with the language model for some period of time. See [their privacy policy](<https://openai.com/policies/privacy-policy>) for more details.`);
    },
    /** @type {CommandHandler} */
    fullpurge: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        if (interaction.user.id !== config.discord.owner_id) return interaction.editReply(`Only the bot owner can use this command.`);
        const db = sqlite3('./main.db');
        const messages = db.prepare(`SELECT * FROM messages`).all();
        for (const message of messages) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(message.input_msg_id);
        }
        db.close();
        log(`${interaction.user.username}#${interaction.user.discriminator} purged all saved messages`);
        interaction.editReply(`Purged ${messages.length} interactions from the database.`);
    },
    /** @type {CommandHandler} */
    users: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        if (interaction.user.id !== config.discord.owner_id) return interaction.editReply(`Only the bot owner can use this command.`);
        const unsetUser = id => {
            if (user.allowed.includes(id))
                users.allowed.splice(users.allowed.indexOf(id), 1);
            if (user.blocked.includes(id))
                users.blocked.splice(users.blocked.indexOf(id), 1);
        }
        const subCommand = {
            allow: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                users.allowed.push(user.id);
                log(`${interaction.user.username}#${interaction.user.discriminator} allowed ${user.username}#${user.discriminator} to use the bot`);
                writeUsers();
                interaction.editReply(`<@${user.id}> can now use the bot!`);
            },
            block: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                users.blocked.push(user.id);
                log(`${interaction.user.username}#${interaction.user.discriminator} blocked ${user.username}#${user.discriminator} from using the bot`);
                writeUsers();
                interaction.editReply(`<@${user.id}> is now blocked from using the bot.`);
            },
            unset: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                log(`${interaction.user.username}#${interaction.user.discriminator} unset ${user.username}#${user.discriminator}'s bot usage`);
                writeUsers();
                interaction.editReply(`<@${user.id}> is no longer allowed or blocked from using the bot. The \`config.public_usage\` option will now apply.`);
            },
            wipe: () => {
                users.allowed = [];
                users.blocked = [];
                log(`${interaction.user.username}#${interaction.user.discriminator} wiped the allow/block list`);
                writeUsers();
                interaction.editReply(`Wiped the list of allowed and blocked users. The \`config.public_usage\` option will now apply to all users.`);
            }
        };
        subCommand[interaction.options.getSubcommand()]();
    }
};
bot.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        try {
            await commands[interaction.commandName](interaction);
        } catch (error) {
            log(`Error while handling slash command:`, error);
        }
    }
});

bot.login(config.discord.token);

setInterval(() => {
    const db = sqlite3('./main.db');
    const messages = db.prepare(`SELECT * FROM messages WHERE time_created < ?`).all((Date.now()-config.delete_message_days*24*60*60*1000));
    for (const message of messages) {
        db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(message.input_msg_id);
    }
    db.close();
    if (messages.length > 0)
        log(`Deleted ${messages.length} old messages`);
}, (60*60*1000));

if (config.http_server.enabled) {
    const srv = express();
    srv.use(logger({ getIP: req => req.headers['cf-connecting-ip'] }))
    srv.use((req, res, next) => {
        res.redirect(`https://github.com/CyberGen49/discord-chatgpt`);
    });
    srv.listen(config.http_server.port, log(`HTTP server listening on port ${config.http_server.port}`));
} else log(`HTTP server is disabled`);