
module.exports = {
    apps: [{
        name: 'discord-chatgpt',
        script: './bot.js',
        watch: [ 'bot.js', 'config.json' ]
    }]
};