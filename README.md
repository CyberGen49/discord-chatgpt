
# ChatGPT Discord Bot
A Discord bot that allows users to interact with OpenAI's `gpt-3.5-turbo` large language model, which is the same one used for ChatGPT.

## Using the bot
You can have a conversation with the bot by sending it a DM. Since you're required to send any part of a conversation that you want the model to "remember" with every request, it's only effective to resend just the previous interaction (prompt and response) with each message.

You can also ping the bot in a server with a prompt, but no conversation history will be available.

## Running the bot yourself
* Download and install Node.js from [here](https://nodejs.org/en/download/) if you don't have it
* Download and install SQLite from [here](https://www.sqlite.org/download.html/) if you don't have it
* Clone (or download and unzip) the repository and `cd` into it with your terminal
* Run `npm install`
* Rename `config-template.json` to `config.json` and open it
* Generate an OpenAI secret key [here](https://platform.openai.com/account/api-keys) and paste it in the `openai.secret` config field
* Create a new Discord application [here](https://discord.com/developers/applications)
    * Set its name, description, and picture
    * Copy the Application ID and paste it in the `discord.id` config field
    * Go to the "Bot" tab and create a new bot
    * Copy the bot token and paste it in the `discord.token` config field
    * Scroll down and make sure "Message content intent" is on
    * Go to the "OAuth2" tab, then to "URL Generator"
    * Check "Bot", then copy the generated URL
    * Open a new tab, paste the URL, and navigate to it
    * Follow the instructions to add the bot to your server
* Make any other changes to the config file, then save it
* Create the message database by running `sqlite3 main.db ".read schema.sql"`
* Register the bot's slash commands by running `node registerCommands.js`
* Start the bot with `node bot.js`
    * If you're on a Unix operating system, run `sh bot.sh` to start the bot and auto-restart it if it crashes