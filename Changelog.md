# discord-chatgpt Changelog
This file exists because sometimes I wait to commit my changes until I've done a bulk of work, but I still want to log exactly what's changing. These logs are ordered by date.

# 2023-03-18
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

# 2023-03-17
- Change config structure
    - Add config option to disable the HTTP server
- Move allowed users to their own file

See commit history for earlier changes.