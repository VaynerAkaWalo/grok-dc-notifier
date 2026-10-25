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
