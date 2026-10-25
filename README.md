# grok-dc-notifier

Holds one Discord Gateway session for a bot and POSTs selected messages to a
Grok Bot webhook routine, so the routine wakes up when someone talks to the bot.
Run exactly one replica: a second Gateway session would forward every message twice.

Built on Bun with two runtime dependencies: [zod](https://zod.dev) validates the
configuration and every Discord payload the notifier reads, and
[pino](https://getpino.io) writes the logs. Everything else is Bun: its own
Gateway client on Bun's WebSocket, `fetch` for REST and the webhook, and
`Bun.serve` for health checks.

## What gets forwarded

Only messages from users in `ALLOWED_USER_IDS`, never from bots or webhooks:

| trigger          | when                                                          |
| ---------------- | ------------------------------------------------------------- |
| `dm`             | a DM to the bot                                               |
| `mention`        | the message mentions the bot user or the bot's managed role  |
| `engaged_thread` | any message in a thread the bot is engaged in                 |

A thread is engaged when the bot created it, it was started from a bot message,
the bot was mentioned in it, or the bot posted in it. Engagement is learned from
Gateway events and cached in memory. After a restart, the first message in an
unknown thread is checked once over REST: the starter message (in the parent
channel, or in the thread for forum posts), then the newest 100 thread messages.
Negative answers are cached for `THREAD_NEGATIVE_TTL`; a later mention or bot post
flips them at once.

Duplicate message IDs are dropped for `DEDUPE_TTL`, and at most
`RATE_LIMIT_PER_MINUTE` messages are forwarded in any 60 s window. Logs are pino
JSON lines (numeric `level`, `time`, `service`, `msg`) with IDs and lengths, never
message contents or secrets; errors are logged as `type`, `message` and `stack` only.

## Webhook body

```json
{
  "trigger": "engaged_thread",
  "guild_id": "123456789012345678",
  "channel_id": "…",
  "thread_id": "…",
  "parent_id": "…",
  "message_id": "…",
  "author": { "id": "…", "username": "…" },
  "content": "…",
  "timestamp": "2026-01-01T00:00:00.000000+00:00",
  "referenced_message": { "message_id": "…", "author": { "id": "…", "username": "…" }, "content": "…" }
}
```

`guild_id` is `null` for DMs. `thread_id` and `parent_id` are `null` outside
threads, and `channel_id` equals `thread_id` inside one. `referenced_message` is
omitted unless the message is a reply.

The request carries `Content-Type: application/json` and
`Authorization: <WEBHOOK_AUTH_HEADER>`. Each message is sent once with no retry.

## Configuration

| variable                | required | default                     |
| ----------------------- | -------- | --------------------------- |
| `DISCORD_BOT_TOKEN`     | yes      |                             |
| `ALLOWED_USER_IDS`      | yes      | comma-separated user IDs    |
| `WEBHOOK_URL`           | yes      |                             |
| `WEBHOOK_AUTH_HEADER`   | yes      | full value, `Bearer crsr_…` |
| `ALLOWED_GUILD_IDS`     | no       | any guild                   |
| `RATE_LIMIT_PER_MINUTE` | no       | `6`                         |
| `DEDUPE_TTL`            | no       | `15m`                       |
| `THREAD_NEGATIVE_TTL`   | no       | `30m`                       |
| `WEBHOOK_TIMEOUT`       | no       | `8s`                        |
| `STALE_AFTER`           | no       | `3m`                        |
| `DISCORD_GATEWAY_URL`   | no       | `wss://gateway.discord.gg`  |
| `PORT`                  | no       | `8080`                      |
| `LOG_LEVEL`             | no       | `info` (`debug` logs skips) |
| `APP_NAME`              | no       | `grok-dc-notifier`          |

`LOG_LEVEL` accepts `trace`, `debug`, `info`, `warn`, `error` or `fatal`.

Invalid configuration stops the process with exit code 2 and one error that
names every bad variable, never its value.

`/healthz` (liveness) fails when the Gateway has been silent for `STALE_AFTER`.
`/readyz` fails while no session is ready. Close codes that a reconnect cannot fix
(bad token 4004, disallowed intents 4014) stop the process with exit code 1.

The bot identifies with `GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT`
(37377). The image runs as the non-root `bun` user and works with a read-only root
filesystem. Idle memory is about 30 MB RSS.

## Discord bot setup

Create an application in the Discord Developer Portal, enable the
**Message Content Intent** on its Bot page, and invite it with the `bot` scope and
View Channels, Send Messages, Send Messages in Threads and Read Message History.

## Layout

| directory      | contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `src/app`      | `Application` wiring and lifecycle, `HealthCheck` endpoints         |
| `src/infra`    | zod env schema and grouped `config`, pino `createLogger`            |
| `src/discord`  | zod payload schemas, `DiscordRestClient`                            |
| `src/gateway`  | `GatewayClient` reconnect loop, `GatewayConnection`, `Heartbeat`, `GatewaySession`, `Backoff` |
| `src/relay`    | `Relay` event queue, `EventRouter`, `MessageHandler`, `ThreadEngagement`, `Forwarder`, `WebhookClient` |
| `src/state`    | in-memory caches: `BotIdentity`, `EngagementCache`, `BotRelatedMessages` |

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun test
```

Merging to `main` publishes `ghcr.io/vaynerakawalo/grok-dc-notifier:latest`
(`linux/amd64` and `linux/arm64`).
