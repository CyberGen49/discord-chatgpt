
# ChatGPT Discord Bot
A Discord bot that allows users to interact with OpenAI's `gpt-3.5-turbo` large language model, which is the same one used for ChatGPT.

## Using the bot
You can have a conversation with the bot by sending it a DM or pinging it in a server with a message. Since you're required to resend any part of a conversation that you want the model to "remember", it's only effective to resend just the previous interaction (prompt and response) with each message, which is only done in DMs.

You can also reply to any message in the channel, DM or server, and ping the bot with another message to use the original one as context.

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
* Make any other changes to the config file ([see below](#configuration)), then save it
* Create the message database by running `sqlite3 main.db ".read schema.sql"`
* Register the bot's slash commands by running `node registerCommands.js`
* Start the bot with `node bot.js`
    * If you're on a Unix operating system, run `sh bot.sh` to start the bot and auto-restart it if it crashes

## Configuration
* `openai`
    * `secret`: Your OpenAI secret key
* `discord`
    * `id`: Your Discord application's ID
    * `token`: Your Discord bot's token
* `admin_tag`: Your Discord tag (username#discriminator) or other identifier to show to users when they aren't allowed to use the bot. They'll be told that they can contact you if they want to be added to the allow list.
* `system_prompt`: The initial `system` message to send with all requests to the language model
* `allowed_users`: An array of Discord user IDs who are allowed to use the bot. If this array is empty, all users are allowed to use the bot.
* `max_input_tokens`: The max size of input messages in [text tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them)
* `max_output_tokens`: The max size of the language model's responses in text tokens
* `usd_per_token`: The cost, in US dollars, of a single text token. This is used to calculate the cost values shown in the `/stats` command.

## Database
This bot stores every message sent to OpenAI, as well as its response, in the database generated during setup.

The database contains a single table, `messages`, whose columns are as follows:

* `time_created`: The timestamp of the interaction
* `user_id`: The ID of the user who sent the message
* `channel_id`: The ID of the channel the message was sent in
* `message_id`: The ID of the user's message
* `input`: The user's input
* `output`: The language model's response
* `count_tokens`: The total number of text tokens that this interaction used

This data is only used for conversation history and the statistics shown in the `/stats` command, so the database can be safely deleted and regenerated at any time. 