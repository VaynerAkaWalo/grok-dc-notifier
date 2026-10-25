import type { z } from "zod";
import { failedFieldPaths } from "../discord/schemas.ts";
import type { Logger } from "../infra/logger.ts";

type Route = (data: unknown) => Promise<void>;

export class EventRouter {
  private readonly routes = new Map<string, Route>();

  constructor(private readonly log: Logger) {}

  on<T>(
    eventTypes: string[],
    schema: z.ZodType<T>,
    handle: (payload: T) => void | Promise<void>,
  ): this {
    for (const eventType of eventTypes) {
      this.routes.set(eventType, async (data) => {
        const payload = this.validate(eventType, schema, data);

        if (payload !== undefined) {
          await handle(payload);
        }
      });
    }

    return this;
  }

  handles(eventType: string): boolean {
    return this.routes.has(eventType);
  }

  async route(eventType: string, data: unknown): Promise<void> {
    await this.routes.get(eventType)?.(data);
  }

  private validate<T>(
    eventType: string,
    schema: z.ZodType<T>,
    data: unknown,
  ): T | undefined {
    const parsed = schema.safeParse(data);

    if (!parsed.success) {
      this.log.warn(
        {
          event: eventType,
          fields: failedFieldPaths(parsed.error),
        },
        "invalid payload, skipping",
      );

      return undefined;
    }

    return parsed.data;
  }
}
