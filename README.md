
# ChatGPT Discord Bot
A Discord bot that allows users to interact with OpenAI's `gpt-3.5-turbo` large language model, which is the same one used for ChatGPT.

Check out [the changelog](/Changelog.md) to see what's changed!

## Using the bot
You can have a conversation with the bot by sending it a DM or pinging it in a server with a message. In DMs, the bot is only able to remember your previous interaction (question and answer), unlike ChatGPT, which is able to remember much further back than that.

Conversation history doesn't work by default in servers, but you can reply to any message in a channel with a ping to the bot, along with another message. This will use the message you replied to as context. This works in DMs as well, if you want to re-address a message that was sent a while ago.

### Slash commands
* `/help`: Outputs some help information.
* `/stats`: Outputs usage statistics.
* `/purge`: Purges all of the user's message entries from the database.
* `/fullpurge`: Purges all message entries from the database.
* `/users`: Manages bot access.
    * `/users allow <user>`: Allows a user to use the bot.
    * `/users block <user>`: Blocks a user from using the bot.
    * `/users unset <user>`: Removes a user from the allow/block list.
    * `/users wipe`: Wipes the allow/block list.

## Running the bot yourself
1. [Download and install Node.js](https://nodejs.org/en/download/) if you don't have it
1. [Download and install SQLite](https://www.sqlite.org/download.html) if you don't have it
1. Clone (or download and unzip) the repository and `cd` into it with your terminal
1. Run `npm install`
1. Rename `config-template.json` to `config.json` and open it
1. [Generate an OpenAI secret key](https://platform.openai.com/account/api-keys) and paste it in the `openai.secret` config field
    * Note: Use of the Chat API isn't free. At the time of writing, it costs $0.002 for every 1000 [text tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them). The token count of a request includes both the user's input, the model's output, and any conversational context provided.
1. [Create a new Discord application](https://discord.com/developers/applications)
    1. Set its name, description, and picture
    1. Copy the Application ID and paste it in the `discord.id` config field
    1. Go to the "Bot" tab and create a new bot
    1. Copy the bot token and paste it in the `discord.token` config field
    1. Scroll down and make sure "Message content intent" is on
    1. Go to the "OAuth2" tab, then to "URL Generator"
    1. Check "Bot", then copy the generated URL
    1. Open a new tab, paste the URL, and navigate to it
    1. Follow the instructions to add the bot to your server
1. Set your Discord user ID in the `discord.owner_id` config field.
1. Make any other changes to the config file ([see below](#configuration)), then save it.
1. Create the message database by running `sqlite3 main.db ".read schema.sql".`
    * This is a required step. See [Database](#database) for details.
1. Register the bot's slash commands by running `node registerCommands.js`
1. Start the bot with `node bot.js`
    * If you're on a Unix operating system, run `sh bot.sh` to start the bot and auto-restart it if it crashes.
1. If you left `config.public_usage` disabled, use `/users allow` to allow yourself to use the bot.
1. Try it out by DMing the bot a question!

## Configuration
The main configuration is located in `config.json`:

* `openai`
    * `secret`: Your OpenAI secret key.
* `discord`
    * `id`: Your Discord application's ID.
    * `token`: Your Discord bot's token.
    * `owner_id`: Your Discord user ID. Users will be told to contact this user if they aren't allowed to use the bot.
* `system_prompt`: The initial `system` message to send with all requests to the language model. This can be used to influence how the model responds. This option can contain `{placeholders}` to customize the system prompt to each message:
    * `{bot_username}`: The bot's username
    * `{user_username}`: The user's username
    * `{user_nickname}`: The user's server nickname, or their username otherwise
* `max_input_tokens`: The max size of input messages in [text tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them)
* `max_output_tokens`: The max size of the language model's responses in text tokens
* `usd_per_token`: The cost, in US dollars, of a single text token. This is used to calculate the cost values shown in the `/stats` command.
* `delete_message_days`: Message entries older than this number of days will be automatically deleted from the database.
* `public_usage`: If `true`, all users will be able to use the bot by default. If `false`, only users allowed with `/users allow` will be able to use the bot.
* `ignore_prefixes`: If one of these strings is present at the beginning of a message, the message will be ignored.
* `http_server`
    * `enabled`: Whether or not to enable the HTTP server. For now, any request to that server is redirected to this GitHub repository.
    * `port`: The port to host the server on, if enabled.

## Database
The bot stores every message with its accompanying response in the database we generated during setup.

The database contains a single table, `messages`, with the following columns:

* `time_created`: The timestamp of the interaction
* `user_id`: The ID of the user who sent the message
* `channel_id`: The ID of the channel the message was sent in
* `input_msg_id`: The ID of the user's message
* `output_msg_id`: The ID of the response message
* `input`: The user's input
* `output`: The language model's response
* `count_tokens`: The total number of text tokens that this interaction used

This data is only used for conversation history, so the database can be safely deleted and regenerated at any time. See the `delete_message_days` config option to set up automatic message deletion.
