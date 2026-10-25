import type { Logger } from "../infra/logger.ts";
import type { Dedupe } from "./dedupe.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import { SerialQueue } from "./serial-queue.ts";
import type { WebhookSender } from "./webhook-client.ts";
import type { WebhookEvent } from "./webhook-event.ts";

const maxPendingPosts = 32;

export class Forwarder {
  private readonly posts = new SerialQueue(maxPendingPosts);

  constructor(
    private readonly dedupe: Dedupe,
    private readonly limiter: RateLimiter,
    private readonly webhook: WebhookSender,
    private readonly log: Logger,
  ) {}

  get pending(): number {
    return this.posts.size;
  }

  forward(event: WebhookEvent) {
    const ids = { messageId: event.message_id, channelId: event.channel_id };

    if (!this.dedupe.isFirstSighting(event.message_id)) {
      this.log.info({ messageId: event.message_id }, "skipped duplicate");

      return;
    }

    if (!this.limiter.tryAcquire()) {
      this.log.warn(ids, "rate limited, dropping");

      return;
    }

    this.enqueuePost(event);
    this.log.info(
      {
        ...ids,
        trigger: event.trigger,
        contentLength: event.content.length,
      },
      "queued",
    );
  }

  drained(): Promise<void> {
    return this.posts.drained();
  }

  private enqueuePost(event: WebhookEvent) {
    const ids = { messageId: event.message_id, channelId: event.channel_id };

    const post = async () => {
      await this.webhook.send(event);
      this.log.info(
        {
          ...ids,
          trigger: event.trigger,
          authorId: event.author.id,
        },
        "forwarded",
      );
    };

    const reportFailure = (err: unknown) =>
      this.log.error({ ...ids, err }, "webhook post failed");

    if (!this.posts.tryEnqueue(post, reportFailure)) {
      this.log.warn(
        {
          messageId: event.message_id,
        },
        "send queue full, dropping",
      );
    }
  }
}
