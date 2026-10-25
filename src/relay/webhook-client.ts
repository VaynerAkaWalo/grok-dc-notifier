import type { WebhookEvent } from "./webhook-event.ts";

export interface WebhookSender {
  send(event: WebhookEvent): Promise<void>;
}

export interface WebhookClientOptions {
  url: string;
  authHeader: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class WebhookClient implements WebhookSender {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: WebhookClientOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async send(event: WebhookEvent): Promise<void> {
    const res = await this.fetch(this.options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.options.authHeader,
        "User-Agent": "grok-dc-notifier",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    await res.body?.cancel();

    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
  }
}
