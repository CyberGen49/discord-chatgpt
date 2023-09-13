
// Import modules
const fs = require('fs');
const sqlite3 = require('better-sqlite3');
const dayjs = require('dayjs');
const dayjsUTC = require('dayjs/plugin/utc');
const dayjsTimezone = require('dayjs/plugin/timezone');
const dayjsAdvanced = require('dayjs/plugin/advancedFormat');
const clc = require('cli-color');
const tokens = require('gpt-3-encoder');
const axios = require('axios');
const OpenAI = require('openai');
const { marked } = require('marked');
const Discord = require('discord.js');
const express = require('express');

// Extend Day.js
dayjs.extend(dayjsUTC);
dayjs.extend(dayjsTimezone);
dayjs.extend(dayjsAdvanced);

// Read config
const config = require('./config.json');

// Read in or build stats object
const stats = fs.existsSync('./stats.json') ? require('./stats.json') : {
    totalInteractions: 0,
    totalTokens: 0,
    users: {},
    months: {}
};
// Read in or build the user access list object
const users = fs.existsSync('./users.json') ? require('./users.json') : {
    allowed: [],
    blocked: []
};

// Configure OpenAI
const configuration = new OpenAI.Configuration({
    apiKey: config.openai.secret,
});
const openai = new OpenAI.OpenAIApi(configuration);

// Function for logging to the console with a timestamp
const log = (...args) => {
    const timestamp = `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}]`;
    console.log(clc.white(timestamp), ...args);
    if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');
    const logFile = `./logs/${dayjs().format('YYYY-MM-DD')}.log`;
    fs.appendFileSync(logFile, `${timestamp} ${args.join(' ')}\n`.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ''));
}

// Functions for writing to stats and users files
const writeStats = () => {
    fs.writeFileSync('./stats.json', JSON.stringify(stats));
}
const writeUsers = () => {
    fs.writeFileSync('./users.json', JSON.stringify(users));
}

// Shortcut function for counting the number of tokens in a string
const countTokens = text => tokens.encode(text).length;

// Function for getting the user's display name
// First we check for a nickname, then for a global name, then for a username
const getUserDisplayName = async user =>
    user.nickname || user.globalName || user.username;

const getAvatarUrl = user => {
    if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${(user.avatar.match(/^a_/)) ? 'gif' : 'png'}?size=512`;
    } else {
        return `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;
    }
};

// Build the bot object and save its user data
const bot = new Discord.Client({
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.MessageContent
    ],
    partials: [ Discord.Partials.Channel, Discord.Partials.Message ]
});

// Function for updating the bot's dynamic status
const updateStatus = () => {
    const statsMonth = stats.months[dayjs().format('YYYY-MM')] || {};
    const placeholders = {
        tokens_total: stats.totalTokens.toLocaleString(),
        tokens_month: (statsMonth.totalTokens || 0).toLocaleString(),
        price_total: (stats.totalTokens * config.usd_per_token).toFixed(2),
        price_month: ((statsMonth.totalTokens || 0) * config.usd_per_token).toFixed(2),
        interactions_total: stats.totalInteractions.toLocaleString(),
        interactions_month: (statsMonth.totalInteractions || 0).toLocaleString(),
    };
    const text = config.discord.status.text.replace(/\{(\w+)\}/g, (match, key) => placeholders[key]);
    bot.user.setActivity(text, {
        type: Discord.ActivityType[config.discord.status.type]
    });
    lastStatusSet = Date.now();
}

// Log into the bot
let inviteUrl = '';
bot.once('ready', () => {
    log(`Logged in as ${bot.user.tag}!`);
    inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${bot.user.id}&permissions=2048&scope=bot`;
    log(`Invite URL: ${inviteUrl}`);
    updateStatus();
});
bot.login(config.discord.token);

// Contains keys for each user ID, set to a boolean determining
// whether they're currently waiting for a response or not
const userIsGenerating = {};
// Contains keys for each channel ID, set to a timestamp of
// their last activity
const channelLastActive = {};

// Handle new messages
// `existingReply` is set to a message object in the event of a regen
bot.on('messageCreate', async(msg, existingReply = null) => {

    const state = clc.cyanBright(`[${msg.id}]`);
    const now = Date.now();
    channelLastActive[msg.channel.id] = now;

    // Function for sending a typing indicator
    const sendTyping = async() => {
        if (!existingReply)
            await msg.channel.sendTyping();
    }

    // Function for replying to the message
    // Returns the resulting new message object or null if there was an error
    const sendReply = async(content, allowedMentions, components) => {
        try {
            // Determine if we need to send a text file instead
            // This should happen if our content is at or over 2k chars
            const textFileName = `response-${msg.id}.txt`;
            let shouldSendTextFile = false;
            if (content.length > 1999) {
                log(state, `Sending response as ${textFileName}`);
                fs.writeFileSync(textFileName, content);
                shouldSendTextFile = true;
                // If the HTTP server is enabled, also send a link to view
                // the conversation online
                content = '';
                if (config.http_server.enabled) {
                    content = `<http${config.http_server.secure ? 's':''}://${config.http_server.hostname}/convo/${msg.id}>`;
                }
            }
            // Determine the method to send with
            // If there's been activity since this message, reply to it
            // If this is an existing reply, edit it
            let replyMethod = data => msg.channel.send(data);
            if (now !== channelLastActive[msg.channel.id]) {
                replyMethod = data => msg.reply(data);
            }
            if (existingReply) {
                replyMethod = data => existingReply.edit(data);
            }
            // Build the response object
            const data = {
                content: content,
                files: shouldSendTextFile ? [ textFileName ] : [],
                components: components || []
            };
            if (allowedMentions) data.allowedMentions = allowedMentions;
            // Send the message and delete the text file if necessary
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

    // Function for building the OpenAI messages object with context
    const getMessagesObject = async(msg) => {
        let messages = [
            { role: 'user', content: input }
        ];
        // If the message was a reply, use the replied-to message as context
        if (msg.type == Discord.MessageType.Reply) {
            const srcMsg = msg.channel.messages.cache.get(msg.reference.messageId);
            const msgType = (srcMsg.author.id == bot.user.id) ? 'assistant' : 'user';
            // If the replied-to message was from the bot, check if that message's
            // input is saved in the database. If so, use that input as context as well.
            if (msgType == 'assistant') {
                const lastMsg = db.prepare(`SELECT * FROM messages WHERE channel_id = ? AND output_msg_id = ?`).get(msg.channel.id, srcMsg.id);
                if (lastMsg) {
                    messages = [
                        { role: 'user', content: lastMsg.input },
                        { role: 'assistant', content: lastMsg.output },
                        ...messages
                    ];
                    log(state, `Using replied-to saved input and output as context`);
                } else {
                    messages.unshift({ role: msgType, content: srcMsg.content });
                    log(state, `Using replied-to user message as context (couldn't find saved message)`);
                }
            } else {
                messages.unshift({ role: msgType, content: srcMsg.content });
                log(state, `Using replied-to user message as context`);
            }
        // If the message was sent in DMs, use the previous message as context
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
        // Generate placeholders
        const authorGuildUser = msg.guild ? msg.guild.members.cache.get(msg.author.id) : null;
        const placeholders = {
            user_username: msg.author.username,
            user_nickname: await getUserDisplayName(authorGuildUser?.nickname ? authorGuildUser : msg.author),
            bot_username: bot.user.username,
            time: dayjs().format('h:mm A'),
            date: dayjs().format('dddd, MMMM D, YYYY'),
            timezone: dayjs().format('zzz')
        };
        // Prepare configured starter messages and add them to the stack
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

    // Function for sending the messages object to OpenAI and getting
    // a language model response
    const getChatResponse = async(messages = []) => {
        // Predict the final token count by counting the tokens in the
        // stringified messages object
        let predictedTokenCount = countTokens(JSON.stringify(messages));
        log(state, `Making OpenAI request of approx. ${predictedTokenCount} tokens`);
        // Make requests until success or too many failures
        // Returns an object with `success`, `data`, and `error` keys
        const res = await (async() => {
            const result = { success: false, data: null, error: null };
            let tries = 0;
            while (true) {
                tries++;
                try {
                    // Make the request
                    const completion = await openai.createChatCompletion({
                        model: config.openai.model,
                        messages: messages
                    }, {
                        timeout: 1000*config.request_timeout
                    });
                    // Update result and break
                    result.success = true;
                    result.data = completion.data;
                    break;
                } catch (error) {
                    // Update result and attempt to try again
                    result.error = error.response ? error.response.data.error.message : error.message;
                    if (tries >= config.request_tries) {
                        log(state, `Request failed (${tries})!`);
                        break;
                    }
                    log(state, `Request failed (${tries})! Retrying...`);
                }
            }
            return result;
        })();
        // Prepare gpt object
        const gpt = { success: false, reply: null, error: null, count_tokens: 0 };
        // If the response was successful, update the gpt object and sanitize the reply
        if (res.success) {
            gpt.success = true;
            gpt.reply = res.data.choices[0].message.content
                .replace(/([@])/g, '\\$1')
                .replace(/```\n\n/g, '```')
                .replace(/\n\n```/g, '\n```');
            gpt.count_tokens = res.data.usage.total_tokens;
            log(state, `Received OpenAI response of ${gpt.count_tokens} tokens`);
        // Otherwise, just update the gpt object with the error
        } else {
            gpt.error = res.error;
        }
        return gpt;
    };

    // If the author is a bot, do nothing
    if (msg.author.bot && !config.discord.allowed_bots.includes(msg.author.bot.id)) return;

    // If the message was sent in a guild but didn't
    // ping the bot, do nothing
    if (msg.guild && !msg.mentions.has(bot.user.id)) return;

    // If the author is blocked, inform them and stop
    if (users.blocked.includes(msg.author.id)) {
        log(state, `User ${msg.author.tag} is blocked`);
        return sendReply(`You're blocked from using me!`);
    }

    // If the bot isn't public and the author isn't allowed,
    // send the owner a message to allow or block them, then
    // inform the author and stop
    const isOwner = msg.author.id === config.discord.owner_id;
    if (!config.public_usage && !users.allowed.includes(msg.author.id) && !isOwner) {
        log(state, `User ${msg.author.tag} isn't allowed`);
        const owner = await bot.users.fetch(config.discord.owner_id);
        await owner.send({
            content: `<@${msg.author.id}> tried using the bot but they aren't allowed to.`,
            components: [
                new Discord.ActionRowBuilder().addComponents([
                    new Discord.ButtonBuilder()
                        .setCustomId(`user.allow.${msg.author.id}`)
                        .setLabel(`Allow ${await getUserDisplayName(msg.author)}`)
                        .setStyle(Discord.ButtonStyle.Success),
                    new Discord.ButtonBuilder()
                        .setCustomId(`user.block.${msg.author.id}`)
                        .setLabel(`Block ${await getUserDisplayName(msg.author)}`)
                        .setStyle(Discord.ButtonStyle.Danger)
                ])
            ]
        });
        return sendReply(`Only certain users are allowed to talk to me right now. A message has been sent to <@${config.discord.owner_id}> so they can add you if they want.`, {
            users: []
        });
    }

    // If the author is already waiting on a response, inform them and stop
    if (userIsGenerating[msg.author.id]) {
        log(state, `User ${msg.author.tag} tried to generate while generating`);
        return sendReply(`One message at a time!`);
    }

    // Sanitize the input message and replace pings and channels with their names
    let input = msg.content;
    const pingMatches = msg.content.match(/<@(\d+)>/g) || [];
    const channelMatches = msg.content.match(/<#(\d+)>/g) || [];
    for (const match of pingMatches) {
        // Remove pings from bot user itself
        if (match.includes(bot.user.id)) {
            input = input.replace(match, '');
            continue;
        }
        const id = match.replace(/\D/g, '');
        const user = msg.guild ? msg.guild.members.cache.get(id).user : bot.users.cache.get(id);
        const userName = await getUserDisplayName(user);
        input = input.replace(match, userName);
    }
    for (const match of channelMatches) {
        input = input.replace(match, '');
    }
    input = input.split(' ').filter(String).join(' ').trim();

    // If the sanitized input is empty, inform the user and stop
    if (!input) {
        log(state, `User ${msg.author.tag} made an empty ping`);
        return sendReply(`Hi! Ping me again with a message and I'll try my best to answer it!`);
    }

    // If the sanitized input starts with a configured ignored prefix, stop
    for (const prefix of config.ignore_prefixes) {
        if (input.startsWith(prefix)) {
            return log(state, `User ${msg.author.tag} used an ignored prefix`);
        }
    }

    // If the sanitized input's token count exceeds the configured max,
    // inform the user and stop
    if (countTokens(input) > config.max_input_tokens) {
        log(state, `User ${msg.author.tag} sent a message that exceeded config.max_input_tokens`);
        return sendReply(`That message is too long for me to handle! Can you make it shorter?`);
    }

    log(state, `User ${msg.author.tag} sent a valid message`);

    // Periodically send typing indicator
    await sendTyping();
    const typingInterval = setInterval(sendTyping, 3000);
    // Open the database
    const db = sqlite3('./main.db');
    try {
        userIsGenerating[msg.author.id] = true;
        // If this is an existing reply, delete the old interaction
        if (existingReply) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(msg.id);
        }
        // Get the messages object and get a response from OpenAI
        const messages = await getMessagesObject(msg);
        const gpt = await getChatResponse(messages);
        clearInterval(typingInterval);
        // Throw an error if the request was unsuccessful
        if (!gpt.success) {
            throw new Error(`Request failed: ${gpt.error}`);
        }
        // Append the response to the messages object and add this
        // interaction to the messages database
        messages.push({ role: 'assistant', content: gpt.reply });
        db.prepare(`INSERT INTO messages (time_created, user_id, channel_id, input_msg_id, input, output, messages, count_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), msg.author.id, msg.channel.id, msg.id, input, gpt.reply, JSON.stringify(messages), gpt.count_tokens);
        // Initialize stats object
        const month = dayjs().format('YYYY-MM');
        stats.users[msg.author.id] = stats.users[msg.author.id] || {
            interactions: 0,
            tokens: 0
        };
        // Create stats object for this month if it doesn't exist
        if (!stats.months[month]) stats.months[month] = {
            totalInteractions: 0,
            totalTokens: 0,
            users: {}
        };
        // Create stats object for this user this month if it doesn't exist
        if (!stats.months[month].users[msg.author.id]) {
            stats.months[month].users[msg.author.id] = {
                interactions: 0,
                tokens: 0
            }
        }
        // Update all-time and monthly stats
        const updateStats = obj => {
            obj.totalInteractions++;
            obj.totalTokens += gpt.count_tokens;
            obj.users[msg.author.id].interactions++;
            obj.users[msg.author.id].tokens += gpt.count_tokens;
        }
        updateStats(stats);
        updateStats(stats.months[month]);
        writeStats();
        // Send the response
        const output = await sendReply(gpt.reply, {
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
        updateStatus();
        // Update the database with the output message ID
        db.prepare(`UPDATE messages SET output_msg_id = ? WHERE input_msg_id = ?`).run(output.id, msg.id);
    } catch (error) {
        // Inform the user of the error
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
    }
    db.close();
    userIsGenerating[msg.author.id] = false;
    log(state, `Interaction took ${((Date.now()-now)/1000).toFixed(2)} seconds`);
});

// Handle message deletion
// If the input message is deleted, delete the output message from
// Discord and the interaction from the database
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

// Handle message edits
// If the input message is edited, regenerate the output message
// using the new input
bot.on('messageUpdate', async(msgOld, msg) => {
    if (msg.author.bot) return;
    const db = sqlite3('./main.db');
    const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ?`).get(msg.id);
    db.close();
    if (!entry) return;
    const response = await msg.channel.messages.fetch(entry.output_msg_id);
    if (!response) return;
    log(`Message ${msg.id} was edited`);
    await response.edit({
        content: '...',
        attachments: []
    });
    // Emit a messageCreate event on the bot, passing it the new message along with
    // the saved interaction so it can be updated
    bot.emit('messageCreate', msg, response);
});

/**
 * @callback CommandHandler
 * @param {Discord.CommandInteraction} interaction
 */
const commands = {
    /** 
     * Sends the user the contents of `./command.help.md`
     * @type {CommandHandler}
    */
    help: async(interaction) => {
        await interaction.reply(fs.readFileSync('./command.help.md', 'utf8'));
        log(`${interaction.user.tag} used /help`);
    },
    /** 
     * Compiles stats into pretty embeds
     * @type {CommandHandler}
    */
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
        log(`${interaction.user.tag} got stats for ${user.tag}`);
    },
    /** 
     * Purges all of the user's interactions from the database
     * @type {CommandHandler}
    */
    purge: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const db = sqlite3('./main.db');
        const messages = db.prepare(`SELECT * FROM messages WHERE user_id = ?`).all(interaction.user.id);
        for (const message of messages) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(message.input_msg_id);
        }
        db.close();
        log(`${interaction.user.tag} purged their saved messages`);
        interaction.editReply(`Purged ${messages.length} interactions from the database. You won't have conversation history until you interact again. This won't affect your statistics shown with **/stats**.\nNote that OpenAI may retain your interactions with the language model for some period of time. See [their privacy policy](<https://openai.com/policies/privacy-policy>) for more details.`);
    },
    /** 
     * Purges the entire database. Only the bot owner can do this.
     * @type {CommandHandler}
    */
    fullpurge: async(interaction) => {
        await interaction.deferReply({ ephemeral: true });
        if (interaction.user.id !== config.discord.owner_id) return interaction.editReply(`Only the bot owner can use this command.`);
        const db = sqlite3('./main.db');
        const messages = db.prepare(`SELECT * FROM messages`).all();
        for (const message of messages) {
            db.prepare(`DELETE FROM messages WHERE input_msg_id = ?`).run(message.input_msg_id);
        }
        db.close();
        log(`${interaction.user.tag} purged all saved messages`);
        interaction.editReply(`Purged ${messages.length} interactions from the database.`);
    },
    /** 
     * Sends the user an invite link for the bot
     * @type {CommandHandler}
    */
    invite: async(interaction) => {
        log(`${interaction.user.tag} get the invite link`);
        interaction.reply({
            content: inviteUrl,
            ephemeral: true
        });
    },
    /** 
     * Allows for managing allowed and blocked users
     * @type {CommandHandler}
    */
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
            // Allows a user to use the bot
            allow: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                users.allowed.push(user.id);
                log(`${interaction.user.tag} allowed ${user.tag} to use the bot`);
                writeUsers();
                interaction.editReply(`<@${user.id}> can now use the bot!`);
                try {
                    user.send({ content: `You've been added to the allow list and can now talk to me!` });
                } catch(e) {}
            },
            // Blocks a user from using the bot
            block: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                users.blocked.push(user.id);
                log(`${interaction.user.tag} blocked ${user.tag} from using the bot`);
                writeUsers();
                interaction.editReply(`<@${user.id}> is now blocked from using the bot.`);
                try {
                    user.send({ content: `You've been blocked from talking to me.` });
                } catch(e) {}
            },
            // Removes a user from the allow/block list
            // `config.public_usage` will determine if they can
            // use the bot or not
            unset: () => {
                const user = interaction.options.getUser('user');
                unsetUser(user.id);
                log(`${interaction.user.tag} unset ${user.tag}'s bot usage`);
                writeUsers();
                interaction.editReply(`<@${user.id}> is no longer allowed or blocked from using the bot. The \`config.public_usage\` option will now apply.`);
            },
            // Wipes the allow/block list
            wipe: () => {
                users.allowed = [];
                users.blocked = [];
                log(`${interaction.user.tag} wiped the allow/block list`);
                writeUsers();
                interaction.editReply(`The list of allowed and blocked users has been wiped. The \`config.public_usage\` option will now apply to all users.`);
            },
            // Lists all users on the allow/block list
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
    },
    /** 
     * Allows the bot owner to use DALL-E
     * @type {CommandHandler}
    */
    dalle: async(interaction) => {
        if (interaction.user.id !== config.discord.owner_id)
            return interaction.reply({
                content: `For now, only the bot owner can use this command.`,
                ephemeral: true
            });
        log(`User ${interaction.user.tag} used the DALL-E command`)
        await interaction.deferReply();
        const generateImage = async(prompt) => {
            try {
                const res = await axios.post(`https://api.openai.com/v1/images/generations`, {
                    prompt: prompt,
                    size: '1024x1024',
                    response_format: 'b64_json'
                }, {
                    headers: { Authorization: `Bearer ${config.openai.secret}` },
                    validateStatus: status => true,
                    timeout: 1000*180
                });
                if (!res.data || res.data?.error) {
                    throw new Error(JSON.stringify(res.data?.error, null, 4));
                }
                log(`Received image generation response from OpenAI`);
                if (!fs.existsSync('./images')) fs.mkdirSync('./images');
                const image = Buffer.from(res.data.data[0].b64_json, 'base64');
                const imagePath = `./images/${interaction.id}.png`;
                fs.writeFileSync(imagePath, image);
                log(`Wrote image to file: ${imagePath}`);
                return { path: imagePath };
            } catch(e) {
                log(`Error while generating image: ${e}`);
                return { error: e };
            }
        };
        const prompt = interaction.options.getString('prompt');
        const res = await generateImage(prompt);
        if (res.error) {
            return interaction.editReply(`Error while generating image!\n\`\`\`${res.error}\`\`\``);
        }
        // Update all-time stats
        const fakeTokenCount = 10000;
            // 10000 tokens at 0.000002 per token = $0.02
        stats.totalInteractions++;
        stats.totalTokens += fakeTokenCount;
        stats.users[interaction.user.id].interactions++;
        stats.users[interaction.user.id].tokens += fakeTokenCount;
        // Update monthly stats
        const month = dayjs().format('YYYY-MM');
        stats.months[month].totalInteractions++;
        stats.months[month].totalTokens += fakeTokenCount;
        stats.months[month].users[interaction.user.id].interactions++;
        stats.months[month].users[interaction.user.id].tokens += fakeTokenCount;
        writeStats();
        // Send reply
        interaction.editReply({
            content: prompt,
            files: [ res.path ]
        });
    },
};

// Handle interactions
bot.on('interactionCreate', async interaction => {
    // If this interaction is a command, run the
    // corresponding command function
    if (interaction.isChatInputCommand()) {
        try {
            await commands[interaction.commandName](interaction);
        } catch (error) {
            log(`Error while handling slash command:`, error);
        }
    }
    // If this interaction is a button click, handle it
    if (interaction.isButton()) {
        try {
            const params = interaction.customId.split('.');
            // User-oriented actions
            if (params[0] == 'user') {
                // Allows the specified user
                if (params[1] == 'allow') {
                    const id = params[2];
                    const user = await bot.users.fetch(id);
                    users.allowed.push(id);
                    log(`User ${user.tag} was allowed to use the bot (via button)`);
                    writeUsers();
                    try {
                        user.send({ content: `Your request to talk has been granted!` });
                        interaction.message.edit({
                            content: `<@${id}> is now allowed to use the bot!`,
                            components: []
                        });
                    } catch(e) {}
                }
                // Blocks the specified user
                if (params[1] == 'block') {
                    const id = params[2];
                    const user = await bot.users.fetch(id);
                    if (users.allowed.includes(id))
                        users.allowed.splice(users.allowed.indexOf(id), 1);
                    users.blocked.push(id);
                    log(`User ${user.tag} was blocked from using the bot (via button)`);
                    writeUsers();
                    try {
                        user.send({ content: `Your request to talk has been denied. Future requests will be ignored.` });
                        interaction.message.edit({
                            content: `<@${id}> is now blocked from using the bot! Their future requests to use it will be ignored.`,
                            components: []
                        });
                    } catch(e) {}
                }
            }
            // Message-oriented actions
            if (params[0] == 'msg') {
                // Regenerates the specified message
                if (params[1] == 'generate') {
                    const id = params[2];
                    if (userIsGenerating[interaction.user.id]) {
                        return interaction.reply({ content: `Wait for the current response to finish first!`, ephemeral: true });
                    }
                    const msg = await interaction.channel.messages.fetch(id);
                    if (!msg) {
                        return interaction.reply({ content: `The source message no longer exists!`, ephemeral: true });
                    }
                    log(`User ${interaction.user.tag} requested message ${interaction.message.id} to be regenerated`);
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
    // If this interaction is a context menu command, handle it
    if (interaction.isContextMenuCommand()) {
        const contextMenuCommand = {
            // Regenerates the selected message
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
                log(`User ${interaction.user.tag} requested for message ${interaction.targetMessage.id} be regenerated`);
                await interaction.targetMessage.edit('...');
                await interaction.reply({ content: `On it!`, ephemeral: true });
                bot.emit('messageCreate', inputMsg, interaction.targetMessage);
            },
            // Dumps the selected interaction's saved data
            'Dump interaction': async() => {
                const db = sqlite3('./main.db');
                const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ? OR output_msg_id = ?`).get(interaction.targetMessage.id, interaction.targetMessage.id);
                db.close();
                if (!entry) {
                    return interaction.reply({ content: `This message isn't in the database!`, ephemeral: true });
                }
                log(`User ${interaction.user.tag} requested a dump of input/output message ${interaction.targetMessage.id}`);
                entry.messages = JSON.parse(entry.messages);
                entry.cost = entry.count_tokens*config.usd_per_token;
                const file = `${interaction.targetMessage.id}.json`;
                fs.writeFileSync(file, JSON.stringify(entry, null, 2));
                await interaction.reply({
                    files: [ file ],
                    ephemeral: true
                });
                fs.rmSync(file);
            },
            // Sends the user a link to view the selected conversation online
            'Get conversation link': async() => {
                if (!config.http_server.enabled) {
                    return interaction.reply({ content: `The conversation viewer is unavailable!`, ephemeral: true });
                }
                const db = sqlite3('./main.db');
                const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ? OR output_msg_id = ?`).get(interaction.targetMessage.id, interaction.targetMessage.id);
                db.close();
                if (!entry) {
                    return interaction.reply({ content: `This message isn't in the database!`, ephemeral: true });
                }
                interaction.reply({ content: `View this conversation:\nhttp${config.http_server.secure ? 's':''}://${config.http_server.hostname}/convo/${interaction.targetMessage.id}`, ephemeral: true });
            }
        }
        try {
            contextMenuCommand[interaction.commandName]();
        } catch (error) {
            log(`Error while handling context menu:`, error);
        }
    }
});

// Periodically check for old messages and delete them
// according to configured settings
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

// Handle the HTTP server if it's enabled
if (config.http_server.enabled) {
    const srv = express();
    // Base route for logging
    srv.use((req, res, next) => {
        res.on('finish', () => {
            log(clc.greenBright(`[${req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress}]`), clc.white(req.method, res.statusCode), req.url);
        });
        next();
    });
    // Static assets
    srv.use(express.static(`${__dirname}/web`));
    // Redirect to the generated bot invite URL
    srv.get('/invite', (req, res) => {
        res.redirect(inviteUrl);
    });
    // Handle the conversation viewer
    srv.get('/convo/:id', async(req, res) => {
        const db = sqlite3('./main.db');
        const entry = db.prepare(`SELECT * FROM messages WHERE input_msg_id = ? OR output_msg_id = ?`).get(req.params.id, req.params.id);
        db.close();
        if (!entry) {
            return res.status(404).end(`The conversation associated with that ID isn't in the database!`);
        }
        entry.messages = JSON.parse(entry.messages);
        const messages = [];
        for (const msg of entry.messages) {
            if (msg.role == 'system') continue;
            let lines = msg.content.split('\n');
            let editedLines = [];
            for (const line of lines) {
                editedLines.push(line.replace(/^```(.{12,})/, '```\n$1'));
            }
            messages.push({
                role: msg.role,
                html: marked.parse(editedLines.join('\n'), {
                    mangle: false,
                    headerIds: false
                })
            });
        }
        const data = {
            bot: bot.user,
            user: bot.users.cache.get(entry.user_id) || await bot.users.fetch(entry.user_id),
            messages: messages
        };
        data.bot.avatarUrl = getAvatarUrl(data.bot);
        data.user.avatarUrl = getAvatarUrl(data.user);
        res.render(`${__dirname}/web/convo/viewer.ejs`, data);
    });
    // Catch-all, redirect to the GitHub repo
    srv.use((req, res) => {
        res.redirect(`https://github.com/CyberGen49/discord-chatgpt`);
    });
    srv.listen(config.http_server.port, log(`HTTP server listening on port ${config.http_server.port}`));
} else log(`HTTP server is disabled`);