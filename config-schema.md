# discord-chatgpt Configuration Schema
Generated automatically from [config-schema.json](./config-schema.json).

### object `openai`
OpenAI API settings.

### string `openai.secret`
Your OpenAI secret key.

### object `discord`
Discord bot settings.

### string `discord.id`
Your Discord bot's application ID.

### string `discord.token`
Your Discord bot token.

### string `discord.owner_id`
Your Discord user ID. Only this user is allowed to manage user access, purge the entire database, etc. This user is also always granted access to the bot.

### object `discord.status`
The Discord bot's status.

### string `discord.status.type`
The status type/prefix

Acceptable values: `Playing`, `Listening`, `Watching`

### string `discord.status.text`
The text of the status

### object[] `starter_messages`
A set of message objects to send with every request to the language model, before the user's input or context. These messages can be used to influence the behaviour of the model.Each message object should have a `role` property and a `content` property.

Messages with a `role` of `system` are meant to instruct the model, while messages with `role`s of `assistant` or `user` can be used to start a conversation without the user's input.

### string `starter_messages[].role`
The role of the message. Generally, you should only use `system` messages.

Acceptable values: `system`, `assistant`, `user`

### string `starter_messages[].content`
The content of the message.

Placeholders:
* `{bot_username}`: The bot's username
* `{user_username}`: The user's username
* `{user_nickname}`: The user's server nickname, or their username if they have no nickname


### integer `max_input_tokens`
The maximum length in text tokens that a user's input can be.

### integer `max_output_tokens`
The maximum length in text tokens that the language model's response should be. Responses exceeding this length will be cut off. Responses exceeding Discord's 2000 character limit will be sent as text files instead.

### number `usd_per_token`
The price, in USD, of each text token. This is used to display cost values in the stats command.

OpenAI normally advertizes prices per 1,000 tokens, so be sure to divide by 1,000 when setting this value.

### number `delete_message_days`
Message entries in the database will be deleted when they reach this many days old. Set to 0 to disable automatic deletion.

### boolean `public_usage`
When `true`, any user will be able to use the bot. When `false`, only users allowed through the users allow command or by request will be able to use the bot.

### string[] `ignore_prefixes`
If a message targeting the bot starts with one of these strings, it'll be ignored.

### boolean `show_regenerate_button`
When `true`, a "Regenerate" button will be included in all language model responses. Responses can also be regenerated from the Apps menu, regardless of this setting.

### object `http_server`
HTTP server settings

### boolean `http_server.enabled`
Whether or not to enable the HTTP server. Requests to /invite will redirect to the bot's invite URL, and all other requests will redirect to the GiHub repository.

### integer `http_server.port`
The port to host the HTTP server on, if enabled.

