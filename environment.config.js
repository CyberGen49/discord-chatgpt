
module.exports = {
    apps: [{
        name: 'discord-chatgpt',
        script: './bot.js',
        watch: [ 'main.js', 'config.json' ]
    }]
};