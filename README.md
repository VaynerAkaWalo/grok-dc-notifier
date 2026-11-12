# grok-dc-notifier

A Bun + TypeScript Discord bot that forwards relevant DMs, mentions and engaged
thread messages to a Grok Bot webhook, and exposes a private MCP endpoint for
Discord actions.

Docker image: `ghcr.io/vaynerakawalo/grok-dc-notifier`

## Environment

Required:

- `DISCORD_BOT_TOKEN` - Discord bot token with the Message Content intent
- `WEBHOOK_URL` - Grok Bot routine webhook URL
- `WEBHOOK_AUTH_HEADER` - full webhook Authorization header value
- `ALLOWED_USER_IDS` - comma-separated user IDs whose messages are forwarded

Optional: `RELAY_API_TOKEN` enables the MCP endpoint with a bearer token of at
least 32 characters. Without it the endpoint returns 503. `ALLOWED_GUILD_IDS` limits webhook
events (all guilds if unset), `PORT` defaults to 8080, `LOG_LEVEL` to info and
`RATE_LIMIT_PER_MINUTE` to 6. Other optional settings are `APP_NAME`
(grok-dc-notifier), `DISCORD_GATEWAY_URL` (wss://gateway.discord.gg),
`WEBHOOK_TIMEOUT` (8s), `DEDUPE_TTL` (15m), `THREAD_NEGATIVE_TTL` (30m) and
`STALE_AFTER` (3m).

## Grok Bot setup

1. Create a webhook-triggered routine and configure its URL and Authorization
   header in the notifier.
2. Add `https://grok-dc-notifier.blamedevs.com/api/mcp` over Tailscale as an MCP
   connector, sending `Authorization: Bearer <RELAY_API_TOKEN>`.

## MCP endpoint

`POST /api/mcp` is a stateless Streamable HTTP endpoint that returns JSON. GET
and DELETE return 405, and requests are limited to 16 KiB. Browser requests must
come from the endpoint's own origin. `/healthz` and `/readyz` are the
unauthenticated pod probes.

Tools take string Discord IDs and only work in the BLAME DEVS guild, DMs and
other guilds are rejected. The bot needs View Channel, Read Message History, Send
Messages, Create Public Threads, Send Messages in Threads and Add Reactions as
appropriate.

- `create_thread`: `channel`, `message`, `name`, optional `auto_archive_duration`
  (60, 1440, 4320 or 10080)
- `post_message`: `channel`, `content` (1 to 2000 characters), optional
  `reply_to`. All mentions are disabled, including replies.
- `list_messages`: `channel`, optional `limit` (1 to 100, default 50) and
  `before`. Newest first, with embeds.
- `get_message`: `channel`, `message`, with embeds
- `add_reaction`: `channel`, `message`, `emoji` as Unicode or `name:id`

Invalid input comes back as an `isError` tool result with the SDK's validation
text. Discord failures are `isError` results with a JSON `error` text. Only
Discord 429 responses are retried, at most twice. A failed write can still have
succeeded, so check history before retrying a post or thread creation.
