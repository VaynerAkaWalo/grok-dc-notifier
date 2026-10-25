export interface HealthSource {
  isConnected(): boolean;
  lastActivityAt(): number;
}

// /healthz (liveness) fails only when the gateway has been silent for
// staleAfterMs, so short reconnects do not restart the pod.
// /readyz fails while no session is READY/RESUMED.
export function createHealthHandler(
  gateway: HealthSource,
  staleAfterMs: number,
  now: () => number = Date.now,
) {
  return (req: Request): Response => {
    const { pathname } = new URL(req.url);

    if (req.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    if (pathname === "/healthz") {
      return now() - gateway.lastActivityAt() > staleAfterMs
        ? new Response("gateway stale", { status: 503 })
        : new Response("ok");
    }

    if (pathname === "/readyz") {
      return gateway.isConnected()
        ? new Response("ok")
        : new Response("gateway not connected", { status: 503 });
    }

    return new Response("not found", { status: 404 });
  };
}
