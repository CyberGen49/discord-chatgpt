# discord-chatgpt Changelog
This file exists because sometimes I wait to commit my changes until I've done a bulk of work, but I still want to log exactly what's changing. These logs are ordered by date.

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