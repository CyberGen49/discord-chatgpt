
# ChatGPT Discord Bot
A Discord bot that allows users to interact with OpenAI's `gpt-3.5-turbo` large language model, which is the same one used for ChatGPT.

## Using the bot
You can have a conversation with the bot by sending it a DM or pinging it in a server with a message. In DMs, the bot is only able to remember your previous interaction (question and answer), unlike ChatGPT, which is able to remember much further back than that.

Conversation history doesn't work by default in servers, but you can reply to any message in a channel with a ping to the bot, along with another message. This will use the message you replied to as context. This works in DMs as well, if you want to re-address a message that was sent a while ago.

## Running the bot yourself
1. [Download and install Node.js](https://nodejs.org/en/download/) if you don't have it
1. [Download and install SQLite](https://www.sqlite.org/download.html/) if you don't have it
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
1. Make any other changes to the config file ([see below](#configuration)), then save it
1. Create the message database by running `sqlite3 main.db ".read schema.sql"`
1. Register the bot's slash commands by running `node registerCommands.js`
1. Start the bot with `node bot.js`
    1. If you're on a Unix operating system, run `sh bot.sh` to start the bot and auto-restart it if it crashes

## Configuration
* `openai`
    * `secret`: Your OpenAI secret key
* `discord`
    * `id`: Your Discord application's ID
    * `token`: Your Discord bot's token
* `admin_tag`: Your Discord tag (username#discriminator) or other identifier to show to users when they aren't allowed to use the bot. They'll be told that they can contact you if they want to be added to the allow list.
* `system_prompt`: The initial `system` message to send with all requests to the language model. This can be used to influence how the model responds.
* `allowed_users`: An array of Discord user IDs who are allowed to use the bot. If this array is empty, all users are allowed to use the bot.
* `max_input_tokens`: The max size of input messages in [text tokens](https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them)
* `max_output_tokens`: The max size of the language model's responses in text tokens
* `usd_per_token`: The cost, in US dollars, of a single text token. This is used to calculate the cost values shown in the `/stats` command.
* `delete_message_days`: Message entries older than this number of days will be automatically deleted from the database

## Database
This bot stores every message sent to OpenAI, as well as its response, in the database generated during setup.

The database contains a single table, `messages`, with columns are as follows:

* `time_created`: The timestamp of the interaction
* `user_id`: The ID of the user who sent the message
* `channel_id`: The ID of the channel the message was sent in
* `input_msg_id`: The ID of the user's message
* `output_msg_id`: The ID of the response message
* `input`: The user's input
* `output`: The language model's response
* `count_tokens`: The total number of text tokens that this interaction used

This data is only used for conversation history, so the database can be safely deleted and regenerated at any time. See the `delete_message_days` config option to set up automatic message deletion.