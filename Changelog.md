# discord-chatgpt Changelog
This file exists because sometimes I wait to commit my changes until I've done a bulk of work, but I still want to log exactly what's changing. These logs are ordered by date.

## 2023-11-06
- Minor refactoring
- Add image attachment capabilities for Vision models
- Update default config to use `gpt-4-turbo` model

## 2023-09-09
- Update modules
- Stop using external API for getting user info
- Update conversation site to use user global name

## 2023-07-20
- Use the `openai` module for requests
- Add tons of comments!
- Refactoring
- Add total and monthly interactions placeholders for the bot's status

## 2023-07-14
- Refactoring
- Update all modules, confirm functionality with Node 20
- Add `config.openai.model` for setting the language model
- Add `config.http_server` `host` and `secure` options
- Add the ability to view conversations in the browser by link
- Add the **Get conversation link** context menu item
- Send a link to view the conversation along with messages that are sent as a text file
    - This helps to still view the rendered message instead of plain text

## 2023-06-14
- Update `discord.js`
- Bug fixes

## 2023-06-12
- Fixes

## 2023-06-11
- Adapt to Discord's new username system
- Add `config.discord.allowed_bots`
- Replace user pings in prompts with their corresponding names
- Code refactoring

## 2023-05-09
- Add date and time prompt placeholders
- Update default starter messages
- Code refactoring

## 2023-03-31
- Treat `/dalle` usage as a single interaction worth 10,000 tokens ($0.02)
    - This is so stats stay accurate

## 2023-03-29
- Fix bugs related to new stats.json files

## 2023-03-26
- Add `cost` property to message dumps
- Add the `/dalle` command
    - Only `config.discord.owner_id` can use it for now

## 2023-03-22
- Fix placeholder replacements
- Store entire messages object in database
- Add context menu command for dumping a message from the database
- Fix context when editing/regenerating messages
- Automatically try again when OpenAI request fails
- Add config options for OpenAI request timeout and retry count

## 2023-03-21
- Add placeholders to status text

## 2023-03-20
- Add the ability to configure multiple system messages
- Make sure the language model isn't able to mention any users, roles, or everyone
- Parse config schema into Markdown and move config documentation into its own file

## 2023-03-19
- Re-set axios request timeout to 120 seconds
- Add invite command
- Add `/users list` subcommand
- Add `/invite` command
- Add context menu command for regenerating a response
- Add "Try again" button on error messages
- Add config option for showing "Regenerate" button on responses
- Add `/invite` HTTP redirect
- Log bot invite URL on login
- Match HTTP logs to the rest of the logs
- Create log files
- Add config schema
- Add block button to usage requests
- Improve error handling

## 2023-03-18
- Add timestamps and colour to logs
- Make logs more verbose
- Add the ability to block users in the users file
- Only create users file once a user command is run
- Improve error handling
- Add `/fullpurge` command for purging the whole messages database
- Add `/users` command and subcommands
- Add `public_usage` config option
- Add `ignore_prefixes` config option
- Save monthly stats in addition to all-time stats
- Beef up stats command with embeds and option to check another user's stats
- Allow placeholders to be used in the system prompt
- Message users when they're allowed or blocked
- Message the owner an allow button when a non-allowed user tries using the bot
- Delete response message when the input message is deleted
- Regenerate response message when the input message is edited
- Make bot status configurable

## 2023-03-17
- Change config structure
    - Add config option to disable the HTTP server
- Move allowed users to their own file

See commit history for earlier changes.