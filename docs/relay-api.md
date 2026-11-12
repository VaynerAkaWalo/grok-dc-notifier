# Discord relay API

Use `Authorization: Bearer <RELAY_API_TOKEN>` on every request. Production is
`https://grok-dc-notifier.blamedevs.com`, reachable through Tailscale via the
internal HTTPS Gateway. `/healthz` and `/readyz` are unauthenticated pod probes.

All routes resolve the channel through Discord and require guild
`1561814224538304512`, including threads. DMs and other guilds are rejected.
The bot needs View Channel, Read Message History, Send Messages, Create Public
Threads, Send Messages in Threads and Add Reactions as appropriate.

- `POST /api/channels/{channel}/messages/{message}/threads` takes
  `{"name":"Discussion","auto_archive_duration":1440}`. Duration is optional
  and may be 60, 1440, 4320 or 10080 minutes. Returns the thread with status 201.
- `POST /api/channels/{channel}/messages` takes
  `{"content":"Reply text","reply_to":"123456789"}`. `reply_to` is optional
  and references a message in the same channel. Content is 1 to 2000 characters.
  Returns the message with status 201. Use the thread ID as the channel to post
  inside a thread. All mention notifications are disabled, including replies,
  users, roles, `@everyone` and `@here`. Caller-supplied `allowed_mentions` is rejected.
- `GET /api/channels/{channel}/messages?limit=50&before={message}` returns a
  newest-first message array including embeds. Limit is 1 to 100 and defaults to
  50. `before` is optional and pages toward older messages.
- `GET /api/channels/{channel}/messages/{message}` returns one message including embeds.
- `PUT /api/channels/{channel}/messages/{message}/reactions/{emoji}` returns 204.
  URL-encode Unicode emoji or `name:id` for a custom emoji.

Errors are JSON with an `error` field. Status 400 means invalid input or a Discord
rejection, 401 means missing or invalid relay credentials, 403 means a forbidden
guild or Discord permission failure and 404 means an unknown route or resource.
Status 429 forwards Discord rate limiting with Retry-After when supplied, 502
means an upstream failure and 503 means the API token is not configured.
Requests are limited to 16 KiB. There are no channel creation or deletion routes.

Only explicit Discord 429 responses are retried, at most twice. The internal
route allows 240 seconds for channel authorization and the Discord operation. Network failures
and other errors on writes are not retried. A failed response can follow a
successful write, so inspect history or the source message's thread before
retrying a message or thread creation to avoid duplicates. Reactions are idempotent.

## MCP connector

The Streamable HTTP endpoint is
`https://grok-dc-notifier.blamedevs.com/api/mcp`. Configure a client or connector
with `Authorization: Bearer <RELAY_API_TOKEN>` on every request. Reuse the relay
API token, never the Discord bot token. No new secret or HTTPRoute change is needed.

The official `@modelcontextprotocol/sdk` Web Standard transport runs on Bun.
The endpoint is stateless and returns JSON responses. Clients must accept both
`application/json` and `text/event-stream` as required by Streamable HTTP.
There are no persistent sessions, resumable streams or server notifications.
GET and DELETE return 405. Requests without an Origin header are supported.
Browser requests must use the endpoint's origin.

The five tools accept strict objects and use string Discord IDs.

- `create_thread` takes `channel`, `message`, `name` and optional
  `auto_archive_duration`, with the same durations as REST.
- `post_message` takes `channel`, `content` and optional `reply_to`.
- `list_messages` takes `channel`, optional numeric `limit` and optional `before`.
- `get_message` takes `channel` and `message`.
- `add_reaction` takes `channel`, `message` and `emoji`, as Unicode or `name:id`.
  Supply the emoji directly without URL encoding.

Tools call the existing relay handler in process, preserving its guild checks,
mention disabling, input limits and Discord error handling. There are no channel
creation or deletion tools. Message reads include embeds. Tool results contain
JSON text, with `isError` for relay failures. Authentication failures use HTTP
401, or 503 when the token is unset. Successful reactions return `{"ok":true}`.
The same write retry caveats above apply to MCP calls.

Rollout needs only the app image update after merge. There is no data migration,
secret change, deploy order dependency or cluster configuration change. Existing
REST clients and pod probes keep their current paths and behavior. Verify
`/readyz` and authenticated MCP initialization after rollout before configuring
a connector. Live Discord and production connectivity are not covered by local tests.

Merge the secrets PR and wait for Vault reconciliation before the deploys PR.
Merge the app PR after the deployment configuration is ready.
The app image updates automatically after its PR merges. An image arriving before
the token leaves the relay disabled and keeps webhook forwarding running. The deploys PR changes the pod template and requires the new Secret key, so
an earlier image rollout also picks up the token when the configuration merges. Confirm image rollout and `/readyz` before configuring Grok
Bot with the relay token obtained securely from Vault. Never give Grok Bot the
Discord token for this integration. No existing data migration is needed.
