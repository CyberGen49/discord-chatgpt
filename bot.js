
const fs = require('fs');
const path = require('path');
const sqlite3 = require('better-sqlite3');
const dayjs = require('dayjs');
const clc = require('cli-color');
const tokens = require('gpt-3-encoder');
const axios = require('axios');
const Discord = require('discord.js');
const express = require('express');
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
let inviteUrl = '';

const log = (...args) => {
    const timestamp = `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}]`;
    console.log(clc.white(timestamp), ...args);
    if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
    const logFile = `./logs/${dayjs().format('YYYY-MM-DD')}.log`;
    fs.appendFileSync(logFile, `${timestamp} ${args.join(' ')}\n`.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ''));
}
const writeStats = () => {
    fs.writeFileSync('./stats.json', JSON.stringify(stats));
}
const writeUsers = () => {
    fs.writeFileSync('./users.json', JSON.stringify(users));
}
const countTokens = text => tokens.encode(text).length;

const bot = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.MessageContent
    ],
    partials: [ Discord.Partials.Channel, Discord.Partials.Message ]
});

let setStatusTimeout;
const setStatus = () => {
    clearTimeout(setStatusTimeout);
    setStatusTimeout = setTimeout(() => {
        const placeholders = {
            tokens_total: stats.totalTokens.toLocaleString(),
            tokens_month: stats.months[dayjs().format('YYYY-MM')].totalTokens.toLocaleString() || 0,
            price_total: (stats.totalTokens * config.usd_per_token).toFixed(2),
            price_month: ((stats.months[dayjs().format('YYYY-MM')].totalTokens || 0) * config.usd_per_token).toFixed(2)
        };
        const text = config.discord.status.text.replace(/\{(\w+)\}/g, (match, key) => placeholders[key]);
        bot.user.setActivity(text, {
            type: Discord.ActivityType[config.discord.status.type]
        });
    }, 1000*5);
}
bot.once('ready', () => {
    log(`Logged in as ${bot.user.username}#${bot.user.discriminator}!`);
    inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${bot.user.id}&permissions=2048&scope=bot`;
    log(`Invite URL: ${inviteUrl}`);
    setStatus();
});

const userIsGenerating = {};
const channelLastActive = {};
bot.on('messageCreate', async(msg, existingReply = null) => {
    const state = clc.cyanBright(`[${msg.id}]`);
    const now = Date.now();
    channelLastActive[msg.channel.id] = now;
    if (msg.author.bot) return;
    if (msg.guild && !msg.mentions.has(bot.user.id)) return;
    const sendTyping = async() => {
        if (!existingReply)
            await msg.channel.sendTyping();
    }
    const sendReply = async(content, allowedMentions, components) => {
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
            if (existingReply) {
                replyMethod = data => existingReply.edit(data);
            }
            const data = {
                content: content,
                files: shouldSendTextFile ? [ textFileName ] : [],
                components: components || []
            };
            if (allowedMentions) data.allowedMentions = allowedMentions;
            const newMsg = await replyMethod(data);
            log(state, `Response message ${newMsg.id} sent`);
            if (shouldSendTextFile)
                fs.rmSync(textFileName);
            return newMsg;
        } catch (error) {
            log(state, error);
            return null;
        }
    }
    if (users.blocked.includes(msg.author.id)) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} is blocked`);
        return sendReply(`You're blocked from using me!`);
    }
    const isOwner = msg.author.id === config.discord.owner_id;
    if (!config.public_usage && !users.allowed.includes(msg.author.id) && !isOwner) {
        log(state, `User ${msg.author.username}#${msg.author.discriminator} isn't allowed`);
        const owner = await bot.users.fetch(config.discord.owner_id);
        await owner.send({
            content: `<@${msg.author.id}> tried using the bot but they aren't allowed to.`,
            components: [
                new Discord.ActionRowBuilder()
                    .addComponents([
                        new Discord.ButtonBuilder()
                            .setCustomId(`user.allow.${msg.author.id}`)
                            .setLabel(`Allow ${msg.author.username}`)
                            .setStyle(Discord.ButtonStyle.Success),
                        new Discord.ButtonBuilder()
                            .setCustomId(`user.block.${msg.author.id}`)
                            .setLabel(`Block ${msg.author.username}`)
                            .setStyle(Discord.ButtonStyle.Danger)
                    ])
            ]
        });
        return sendReply(`Only certain users are allowed to talk to me right now. A message has been sent to <@${config.discord.owner_id}> so they can add you if they want.`, {
            users: []
        });
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
    log(state, `User ${msg.author.username}#${msg.author.discriminator} sent a valid message`);
    const getMessagesObject = async(msg) => {
        let messages = [
            { role: 'user', content: input }
        ];
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
        const placeholders = {
            user_username: msg.author.username,
            user_nickname: msg.guild ? msg.guild.members.cache.get(msg.author.id).displayName : msg.author.username,
            bot_username: bot.user.username
        }
        const starterMessages = [];
        for (const msg of config.starter_messages) {
            starterMessages.push({
                role: msg.role,
                content: msg.content.replace(/\{(\w+)\}/g, (match, key) => placeholders[key])
            });
        }
        messages = [
            ...starterMessages,
            ...messages
        ]
        return messages;
    };
    const getChatResponse = async(messages = []) => {
        let tentativeTokenCount = 0;
        for (const message of messages) {
            const tokenCount = countTokens(message.content);
            tentativeTokenCount += tokenCount;
        }
        tentativeTokenCount = countTokens(JSON.stringify(messages));
        try {
            log(state, `Making OpenAI request of approx. ${tentativeTokenCount} tokens`);
            const res = await (async() => {
                let tries = 0;
                let res = null;
                while (true) {
                    tries++;
                    try {
                        res = await axios.post('https://api.openai.com/v1/chat/completions', {
                            model: 'gpt-3.5-turbo',
                            messages: messages,
                            max_tokens: config.max_output_tokens
                        }, {
                            headers: { Authorization: `Bearer ${config.openai.secret}` },
                            validateStatus: status => true,
                            timeout: 1000*config.request_timeout
                        });
                        if (!res.data) {
                            throw new Error(`No data received!`);
                        }
                        if (res.data.error) {
                            throw new Error(`OpenAI responded with an error: ${JSON.stringify(res?.data?.error)}`);
                        }
                    } catch (error) {
                        if (tries >= config.request_tries)
                            throw new Error(error);
                    }
                    if ((res && !res?.error) || (tries >= config.request_tries))
                        return res;
                    log(state, `Request failed! Retrying...`);
                }
            })();
            const gpt = {
                reply: res?.data?.choices[0].message.content || null,
                count_tokens: res?.data?.usage.total_tokens
            };
            if (gpt.reply) gpt.reply = gpt.reply
                .replace(/([@])/g, '\\$1')
                .replace(/```\n\n/g, '```')
                .replace(/\n\n```/g, '\n```');
            log(state, `Received OpenAI response of ${gpt.count_tokens} tokens`);
            return gpt;
        } catch (error) {
            log(state, `${error}`);
            return { error: error };
        }
    };
    await sendTyping();
    const db = sqlite3('./main.db');
    const typingInterval = setInterval(sendTyping, 3000);
    try {
        userIsGenerating[msg.author.id] = true;
        if (existingReply) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(msg.id);
        }
        const messages = await getMessagesObject(msg);
        const gpt = await getChatResponse(messages);
        if (!gpt || gpt?.error || !gpt?.reply) {
            throw new Error(`Request failed: ${gpt.error}`);
        }
        messages.push({ role: 'assistant', content: gpt.reply });
        db.prepare(`INSERT INTO messages (time_created, user_id, channel_id, input_msg_id, input, output, messages, count_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), msg.author.id, msg.channel.id, msg.id, input, gpt.reply, JSON.stringify(messages), gpt.count_tokens);
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
        let outputMsg = await sendReply(gpt.reply, {
            users: [], roles: [], everyone: false
        }, config.show_regenerate_button ? [
            new Discord.ActionRowBuilder()
                .addComponents([
                    new Discord.ButtonBuilder()
                        .setStyle(Discord.ButtonStyle.Secondary)
                        .setCustomId(`msg.generate.${msg.id}`)
                        .setLabel('Regenerate')
                ])
        ] : null);
        setStatus();
        if (outputMsg && outputMsg.id) {
            db.prepare(`UPDATE messages SET output_msg_id = ? WHERE input_msg_id = ?`).run(outputMsg.id, msg.id);
        }
    } catch (error) {
        log(state, `Failed to send message!`, error);
        try {
            await sendReply(`Sorry, something went wrong while replying!\n\`\`\`${error}\`\`\``, null, [
                new Discord.ActionRowBuilder()
                    .addComponents([
                        new Discord.ButtonBuilder()
                            .setStyle(Discord.ButtonStyle.Primary)
                            .setCustomId(`msg.generate.${msg.id}`)
                            .setLabel('Try again')
                    ])
            ]);
        } catch (error) {
            log(state, `Failed to send error message`, error);
        }
        clearInterval(typingInterval);
    }
    db.close();
    userIsGenerating[msg.author.id] = false;
    log(state, `Interaction took ${((Date.now()-now)/1000).toFixed(2)} seconds`);
});
bot.on('messageDelete', async msg => {
    if (msg.author.bot) return;
    const db = sqlite3('./main.db');
    const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ?`).get(msg.id);
    if (!entry) return;
    const response = await msg.channel.messages.fetch(entry.output_msg_id);
    if (!response) return;
    await response.delete();
    log(`Deleted response message ${entry.output_msg_id} because input message ${msg.id} was deleted`);
    db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(msg.id);
    db.close();
});
bot.on('messageUpdate', async(msgOld, msg) => {
    if (msg.author.bot) return;
    const db = sqlite3('./main.db');
    const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ?`).get(msg.id);
    if (!entry) return;
    const response = await msg.channel.messages.fetch(entry.output_msg_id);
    if (!response) return;
    log(`Message ${msg.id} was edited`);
    await response.edit('...');
    bot.emit('messageCreate', msg, response);
    db.close();
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
                        `\$${totalMyCost.toFixed(2)} used`,
                        `${Math.round((totalMyTokens/totalTokens)*100)}% of total`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: `This month`,
                    value: [
                        `${monthMyInteractions.toLocaleString()} messages`,
                        `${monthMyTokens.toLocaleString()} tokens`,
                        `\$${monthMyCost.toFixed(2)} used`,
                        `${Math.round((monthMyTokens/monthTokens)*100)}% of total`
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
    invite: async(interaction) => {
        log(`${interaction.user.username}#${interaction.user.discriminator} get the invite link`);
        interaction.reply({
            content: inviteUrl,
            ephemeral: true
        });
    },
    /** @type {CommandHandler} */
    users: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        if (interaction.user.id !== config.discord.owner_id) return interaction.editReply(`Only the bot owner can use this command.`);
        const unsetUser = id => {
            if (users.allowed.includes(id))
                users.allowed.splice(users.allowed.indexOf(id), 1);
            if (users.blocked.includes(id))
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
                try {
                    user.send({ content: `You've been added to the allow list and can now talk to me!` });
                } catch(e) {}
            },
            block: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                users.blocked.push(user.id);
                log(`${interaction.user.username}#${interaction.user.discriminator} blocked ${user.username}#${user.discriminator} from using the bot`);
                writeUsers();
                interaction.editReply(`<@${user.id}> is now blocked from using the bot.`);
                try {
                    user.send({ content: `You've been blocked from talking to me.` });
                } catch(e) {}
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
                interaction.editReply(`The list of allowed and blocked users has been wiped. The \`config.public_usage\` option will now apply to all users.`);
            },
            list: () => {
                interaction.editReply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setTitle(`Users`)
                            .setColor(0x3789c8)
                            .setDescription(`${config.public_usage ? `All users not blocked here are allowed to use the bot,` : `Only users allowed here are allowed to use the bot,`} as set by \`config.public_usage\`.`)
                            .addFields([
                                {
                                    name: `Allowed`,
                                    value: (() => {
                                        if (users.allowed.length == 0)
                                            return [ `*None*` ];
                                        return users.allowed.map(id => `<@${id}>`);
                                    })().join(', '),
                                    inline: true
                                },
                                {
                                    name: `Blocked`,
                                    value: (() => {
                                        if (users.blocked.length == 0)
                                            return [ `*None*` ];
                                        return users.blocked.map(id => `<@${id}>`);
                                    })().join(', '),
                                    inline: true
                                }
                            ])
                    ]
                });
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
    if (interaction.isButton()) {
        try {
            const params = interaction.customId.split('.');
            if (params[0] == 'user') {
                if (params[1] == 'allow') {
                    const id = params[2];
                    const user = await bot.users.fetch(id);
                    users.allowed.push(id);
                    log(`User ${user.username}#${user.discriminator} was allowed to use the bot (via button)`);
                    writeUsers();
                    try {
                        user.send({ content: `Your request to talk has been granted!` });
                        interaction.reply({ content: `<@${id}> is now allowed to use the bot!` });
                    } catch(e) {}
                }
                if (params[1] == 'block') {
                    const id = params[2];
                    const user = await bot.users.fetch(id);
                    if (users.allowed.includes(id))
                        users.allowed.splice(users.allowed.indexOf(id), 1);
                    users.blocked.push(id);
                    log(`User ${user.username}#${user.discriminator} was blocked from using the bot (via button)`);
                    writeUsers();
                    try {
                        user.send({ content: `Your request to talk has been denied. Future requests will be ignored.` });
                        interaction.reply({ content: `<@${id}> is now blocked from using the bot! Their future requests to use it will be ignored.` });
                    } catch(e) {}
                }
            }
            if (params[0] == 'msg') {
                if (params[1] == 'generate') {
                    const id = params[2];
                    if (userIsGenerating[interaction.user.id]) {
                        return interaction.reply({ content: `Wait for the current response to finish first!`, ephemeral: true });
                    }
                    const msg = await interaction.channel.messages.fetch(id);
                    if (!msg) {
                        return interaction.reply({ content: `The source message no longer exists!`, ephemeral: true });
                    }
                    log(`User ${interaction.user.username}#${interaction.user.discriminator} requested message ${interaction.message.id} to be regenerated`);
                    await interaction.reply({
                        content: `On it!`,
                        ephemeral: true
                    });
                    await interaction.message.edit({
                        content: '...',
                        components: []
                    });
                    bot.emit('messageCreate', msg, interaction.message);
                }
            }
        } catch (error) {
            log(`Error while handling button:`, error);
        }
    }
    if (interaction.isContextMenuCommand()) {
        const contextMenuCommand = {
            'Regenerate response': async() => {
                if (bot.user.id !== interaction.targetMessage.author.id) {
                    return interaction.reply({ content: `This isn't one of my messages!`, ephemeral: true });
                }
                if (userIsGenerating[interaction.user.id]) {
                    return interaction.reply({ content: `Wait for the current response to finish first!`, ephemeral: true });
                }
                const db = sqlite3('./main.db');
                const msg = db.prepare(`SELECT * FROM messages WHERE output_msg_id = ?`).get(interaction.targetMessage.id);
                if (!msg) {
                    db.close();
                    return interaction.reply({ content: `This message either isn't a language model response or can no longer be regenerated.`, ephemeral: true });
                }
                const inputMsg = await interaction.channel.messages.fetch(msg.input_msg_id);
                if (!inputMsg) {
                    db.close();
                    return interaction.reply({ content: `The input message no longer exists!`, ephemeral: true });
                }
                db.close();
                log(`User ${interaction.user.username}#${interaction.user.discriminator} requested for message ${interaction.targetMessage.id} be regenerated`);
                await interaction.targetMessage.edit('...');
                await interaction.reply({ content: `On it!`, ephemeral: true });
                bot.emit('messageCreate', inputMsg, interaction.targetMessage);
            },
            'Dump interaction': async() => {
                const db = sqlite3('./main.db');
                const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ? OR output_msg_id = ?`).get(interaction.targetMessage.id, interaction.targetMessage.id);
                db.close();
                if (!entry) {
                    return interaction.reply({ content: `This message isn't in the database!`, ephemeral: true });
                }
                log(`User ${interaction.user.username}#${interaction.user.discriminator} requested a dump of input/output message ${interaction.targetMessage.id}`);
                entry.messages = JSON.parse(entry.messages);
                const file = `${interaction.targetMessage.id}.json`;
                fs.writeFileSync(file, JSON.stringify(entry, null, 2));
                await interaction.reply({
                    files: [ file ],
                    ephemeral: true
                });
                fs.rmSync(file);
            }
        }
        try {
            contextMenuCommand[interaction.commandName]();
        } catch (error) {
            log(`Error while handling context menu:`, error);
        }
    }
});

bot.login(config.discord.token);

setInterval(() => {
    if (config.delete_message_days >= 0) return;
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
    srv.use((req, res, next) => {
        res.on('finish', () => {
            log(clc.greenBright(`[${req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress}]`), clc.white(req.method, res.statusCode), req.url);
        });
        next();
    });
    srv.get('/invite', (req, res) => {
        res.redirect(inviteUrl);
    });
    srv.get('/schema', (req, res) => {
        res.setHeader('Content-Type', 'application/schema+json');
        res.sendFile(path.join(__dirname, 'config-schema.json'));
    });
    srv.use((req, res) => {
        res.redirect(`https://github.com/CyberGen49/discord-chatgpt`);
    });
    srv.listen(config.http_server.port, log(`HTTP server listening on port ${config.http_server.port}`));
} else log(`HTTP server is disabled`);