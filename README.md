# grok-dc-notifier

A Bun + TypeScript Discord bot that forwards relevant DMs, mentions and engaged
thread messages to a Grok Bot webhook, and provides a private Discord relay API.

Docker image: `ghcr.io/vaynerakawalo/grok-dc-notifier`

## Environment

Required:

- `DISCORD_BOT_TOKEN` - Discord bot token with the Message Content intent
- `WEBHOOK_URL` - Grok Bot routine webhook URL
- `WEBHOOK_AUTH_HEADER` - full webhook Authorization header value
- `ALLOWED_USER_IDS` - comma-separated user IDs whose messages are forwarded

Optional: `RELAY_API_TOKEN` enables the relay API with a bearer token of at least
32 characters. Without it the API is disabled. `ALLOWED_GUILD_IDS` limits webhook
events (all guilds if unset), `PORT` defaults to 8080, `LOG_LEVEL` to info and
`RATE_LIMIT_PER_MINUTE` to 6. Other optional settings are `APP_NAME`
(grok-dc-notifier), `DISCORD_GATEWAY_URL` (wss://gateway.discord.gg),
`WEBHOOK_TIMEOUT` (8s), `DEDUPE_TTL` (15m), `THREAD_NEGATIVE_TTL` (30m) and
`STALE_AFTER` (3m).

## Grok Bot setup

1. Create a webhook-triggered routine and configure its URL and Authorization
   header in the notifier.
2. Give Grok Bot the relay bearer token as a secret and use
   `https://grok-dc-notifier.blamedevs.com/api` over Tailscale for Discord calls.
3. Follow the [relay API](docs/relay-api.md) for threads, replies, history and
   reactions. The relay only permits the BLAME DEVS guild.
