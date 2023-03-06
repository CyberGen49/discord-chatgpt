
const fs = require('fs');
const sqlite3 = require('better-sqlite3');
const tokens = require('gpt-3-encoder');
const axios = require('axios');
const Discord = require('discord.js');
const config = require('./config.json');

const stats = fs.existsSync('./stats.json') ? require('./stats.json') : {
    messages: 0,
    tokens: 0,
    users: {}
};

const writeStats = () => fs.writeFileSync('./stats.json', JSON.stringify(stats, null, 4));
const countTokens = text => tokens.encode(text).length;
const getChatResponse = async(messages = [], user) => {
    messages.unshift({ role: 'system', content: `The user you are chatting with is named "${user.username}"` });
    messages.unshift({ role: 'system', content: config.system_prompt });
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: config.max_output_tokens
    }, {
        headers: { Authorization: `Bearer ${config.openai.secret}` }
    });
    const gpt = {
        reply: res?.data?.choices[0].message.content || null,
        count_tokens: res?.data?.usage.total_tokens
    }
    console.log(`Received response of ${gpt.count_tokens} tokens`);
    return gpt;
}

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
    console.log(`Logged in as ${bot.user.username}#${bot.user.discriminator}!`);
    bot.user.setActivity('your questions', { type: Discord.ActivityType.Listening });
});
const userIsGenerating = {};
const channelLastActive = {};
bot.on('messageCreate', async msg => {
    const now = Date.now();
    channelLastActive[msg.channel.id] = now;
    if (msg.author.bot) return;
    if (msg.guild && !msg.mentions.has(bot.user.id)) return;
    if (config.allowed_users.length > 0 && !config.allowed_users.includes(msg.author.id)) {
        return await msg.channel.send({
            content: `Sorry ${msg.author.username}, but only certain users are allowed to talk to me right now. If you want to be added to the list, contact **${config.admin_tag}**.`
        });
    }
    if (userIsGenerating[msg.author.id]) {
        return await msg.channel.send({
            content: `One message at a time, ${msg.author.username}!`
        });
    }
    const input = msg.content.split(' ').filter(segment => !segment.match(/<(@|#)(\d+)>/)).join(' ').trim();
    if (!input) {
        const defaults = [
            `Hi! How can I assist you today?`,
            `Hello! How can I help you?`,
            `Hello! Is there something specific you need help with or a question you have?`
        ];
        return await msg.channel.send({
            content: defaults[Math.floor(Math.random() * defaults.length)]
        });
    }
    if (countTokens(input) > config.max_input_tokens) {
        return await msg.channel.send({
            content: `${msg.author.username}, that message is too long for me to handle! Can you make it shorter?`
        });
    }
    userIsGenerating[msg.author.id] = true;
    console.log(`Responding to ${msg.author.username}#${msg.author.discriminator}...`);
    const db = sqlite3('./main.db');
    const sendTyping = async() => await msg.channel.sendTyping()
    await sendTyping();
    let typingInterval = setInterval(sendTyping, 3000);
    try {
        const messages = [{ role: 'user', content: input }];
        if (msg.type == Discord.MessageType.Reply) {
            const srcMsg = msg.channel.messages.cache.get(msg.reference.messageId);
            const msgType = (srcMsg.author.id == bot.user.id) ? 'assistant' : 'user';
            messages.unshift({ role: msgType, content: srcMsg.content });
            if (msgType == 'assistant') {
                const lastMsg = db.prepare(`SELECT * FROM messages WHERE channel_id = ? AND output_msg_id = ?`).get(msg.channel.id, srcMsg.id);
                if (lastMsg) {
                    messages.unshift({ role: 'user', content: lastMsg.input });
                    console.log(`Using replied-to saved input and output as context`);
                } else {
                    console.log(`Using replied-to user message as context (couldn't find saved message)`);
                }
            } else {
                console.log(`Using replied-to user message as context`);
            }
        } else if (!msg.guild) {
            const lastMsg = db.prepare(`SELECT * FROM messages WHERE channel_id = ? ORDER BY time_created DESC LIMIT 1`).get(msg.channel.id);
            if (lastMsg) {
                messages.unshift({ role: 'assistant', content: lastMsg.output });
                messages.unshift({ role: 'user', content: lastMsg.input });
                console.log(`Using previous input and output as context`);
            }
        }
        const gpt = await getChatResponse(messages, msg.author);
        gpt.reply = gpt.reply
            .replace(/([@])/g, '\\$1')
            .replace(/```\n\n/g, '```')
            .replace(/\n\n```/g, '\n```');
        db.prepare(`INSERT INTO messages (time_created, user_id, channel_id, input_msg_id, input, output, count_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(Date.now(), msg.author.id, msg.channel.id, msg.id, input, gpt.reply, gpt.count_tokens);
        stats.totalInteractions++;
        stats.totalTokens += gpt.count_tokens;
        stats.users[msg.author.id] = stats.users[msg.author.id] || {
            interactions: 0,
            tokens: 0
        };
        stats.users[msg.author.id].interactions++;
        stats.users[msg.author.id].tokens += gpt.count_tokens;
        writeStats();
        clearInterval(typingInterval);
        let outputMsg;
        if (now !== channelLastActive[msg.channel.id]) {
            outputMsg = await msg.reply({
                content: gpt.reply
            });
        } else {
            outputMsg = await msg.channel.send({
                content: gpt.reply
            });
        }
        if (outputMsg && outputMsg.id) {
            db.prepare(`UPDATE messages SET output_msg_id = ? WHERE input_msg_id = ?`).run(outputMsg.id, msg.id);
        }
    } catch (error) {
        console.error(`Failed to send message`, error);
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
    stats: async(interaction) => {
        const myInteractions = stats.users[interaction.user.id]?.interactions || 0;
        const myTokens = stats.users[interaction.user.id]?.tokens || 0;
        return interaction.reply({
            content: [
                `**Total interactions:** ${stats.totalInteractions}`,
                `**Total tokens:** ${stats.totalTokens}`,
                `**Total cost:** \$${(stats.totalTokens*config.usd_per_token).toFixed(2)}`,
                ``,
                `**My interactions:** ${myInteractions}`,
                `**My tokens:** ${myTokens}`,
                `**My cost:** \$${(myTokens*config.usd_per_token).toFixed(2)}`
            ].join('\n'),
            ephemeral: true
        });
    }
};
bot.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        try {
            await commands[interaction.commandName](interaction);
            console.log(`Handled ${interaction.user.username}#${interaction.user.discriminator}'s use of /${interaction.commandName}`);
        } catch (error) {
            console.error(`Error while handling slash command:`, error);
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
        console.log(`Deleted ${messages.length} old messages`);
}, (60*60*1000));