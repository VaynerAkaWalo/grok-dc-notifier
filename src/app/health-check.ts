export interface HealthSource {
  isConnected(): boolean;
  lastActivityAt(): number;
}

export class HealthCheck {
  constructor(
    private readonly gateway: HealthSource,
    private readonly staleAfterMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  handle = (req: Request): Response => {
    if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    switch (new URL(req.url).pathname) {
      case "/healthz":
        return this.liveness();
      case "/readyz":
        return this.readiness();
      default:
        return new Response("not found", { status: 404 });
    }
  };

  private liveness(): Response {
    const silentForMs = this.now() - this.gateway.lastActivityAt();

    return silentForMs > this.staleAfterMs
      ? new Response("gateway stale", { status: 503 })
      : new Response("ok");
  }

  private readiness(): Response {
    return this.gateway.isConnected()
      ? new Response("ok")
      : new Response("gateway not connected", { status: 503 });
  }
}
