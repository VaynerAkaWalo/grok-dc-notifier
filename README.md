# grok-dc-notifier

A small Bun + TypeScript service that listens to the Discord Gateway and notifies
a Grok Bot routine webhook about relevant messages: DMs to the bot, mentions of the
bot, and messages in threads the bot is engaged in.

Docker image: `ghcr.io/vaynerakawalo/grok-dc-notifier`

## Environment

Required:

- `DISCORD_BOT_TOKEN` - Discord bot token (needs the Message Content intent)
- `WEBHOOK_URL` - Grok Bot routine webhook URL
- `WEBHOOK_AUTH_HEADER` - full `Authorization` header value for the webhook, e.g. `Bearer ...`
- `ALLOWED_USER_IDS` - comma-separated Discord user IDs whose messages are forwarded

Optional: `ALLOWED_GUILD_IDS` (all guilds if unset), `PORT` (8080), `LOG_LEVEL` (info), `RATE_LIMIT_PER_MINUTE` (6).

## Grok Bot setup

1. Ask your Grok Bot to create a routine with a webhook trigger that handles the forwarded Discord message (e.g. replies via the Discord REST API).
2. Open the routine's details and copy its Webhook URL and Authorization header into `WEBHOOK_URL` and `WEBHOOK_AUTH_HEADER`.
3. To let the routine reply on Discord, give Grok Bot the same bot token as a secret (e.g. `DISCORD_BOT_TOKEN`).
