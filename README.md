# AI Message Scanner

This is a Discord bot designed to automatically scan messages for spam and racial slurs, helping to maintain a safe and friendly server environment. It also includes a case management system for staff to review user moderation history.

## Features

- **Anti-Spam:** The bot monitors users' message frequency and similarity. If a user sends too many similar messages in a short period, they will be automatically timed out.
- **Anti-Racial Slurs:** The bot scans messages for a configurable list of racial slurs. If a message contains a slur, it will be deleted, and the user will be warned. After a certain number of warnings, the user will be timed out.
- **Case Management:** Staff members can use the `/cases` command to view a user's moderation history, including past violations and actions taken.

## How it Works

The bot uses the `discord.js` library to interact with the Discord API. It listens for new messages and checks them against the configured rules for spam and racial slurs.

- **Spam Detection:** The bot keeps track of the number of messages a user sends within a specific time window. If the number of messages exceeds a certain threshold and the messages are too similar, the user is considered to be spamming.
- **Racial Slur Detection:** The bot normalizes message content (by converting to lowercase, removing special characters, etc.) and then checks it against a list of banned words.

## Configuration

The bot's behavior can be customized through the `config.json` file. This file includes settings for:

- Staff roles
- Spam detection parameters (threshold, time window, similarity threshold)
- Violation rules (max warnings, timeout duration, list of racial slurs)
- Channels to be exempted from scanning
