import type { Logger } from "../infra/logger.ts";
import type { BotIdentity } from "../state/bot-identity.ts";
import type { EventRouter } from "./event-router.ts";
import type { Forwarder } from "./forwarder.ts";
import { SerialQueue } from "./serial-queue.ts";

const maxPendingEvents = 1024;

export class Relay {
  private readonly events = new SerialQueue(maxPendingEvents);

  constructor(
    private readonly identity: BotIdentity,
    private readonly router: EventRouter,
    private readonly forwarder: Forwarder,
    private readonly log: Logger,
  ) {}

  handle = (eventType: string, data: unknown, botUserId: string) => {
    if (!this.router.handles(eventType)) {
      return;
    }

    const processEvent = async () => {
      this.identity.id = botUserId;
      await this.router.route(eventType, data);
    };

    const reportFailure = (err: unknown) =>
      this.log.error({ event: eventType, err }, "event processing failed");

    if (!this.events.tryEnqueue(processEvent, reportFailure)) {
      this.log.warn({ event: eventType }, "event queue full, dropping");
    }
  };

  async idle(): Promise<void> {
    while (this.events.size > 0 || this.forwarder.pending > 0) {
      await this.events.drained();
      await this.forwarder.drained();
    }
  }
}
