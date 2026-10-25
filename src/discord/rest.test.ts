import { afterAll, expect, test } from "bun:test";
import { createRest, NotFoundError } from "./rest.ts";

let limitedHits = 0;

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);

    if (req.headers.get("authorization") !== "Bot tok") {
      return new Response("unauthorized", { status: 401 });
    }

    if (url.pathname === "/channels/limited") {
      limitedHits++;

      return limitedHits === 1
        ? new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "0.01" },
          })
        : Response.json({ id: "limited", type: 11, parent_id: "p" });
    }

    if (
      url.pathname === "/channels/t/messages" &&
      url.searchParams.get("limit") === "100"
    ) {
      return Response.json([
        { id: "1", channel_id: "t", author: { id: "b" }, mention_roles: ["r"] },
      ]);
    }

    if (url.pathname === "/channels/broken") {
      return Response.json({ type: 11 });
    }

    return new Response("missing", { status: 404 });
  },
});

afterAll(() => server.stop(true));

const api = createRest({ token: "tok", baseUrl: server.url.origin });

test("retries after 429", async () => {
  const channel = await api.channel("limited");

  expect(channel.parent_id).toBe("p");
  expect(limitedHits).toBe(2);
});

test("lists messages", async () => {
  const messages = await api.messages("t", 100);

  expect(messages[0]?.mention_roles).toEqual(["r"]);
});

test("maps 404 to NotFoundError", async () => {
  expect(api.message("x", "y")).rejects.toBeInstanceOf(NotFoundError);
});

test("rejects responses that do not match the schema", async () => {
  const error = await api.channel("broken").catch((err: unknown) => err);

  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(NotFoundError);
  expect(String(error)).toContain("unexpected response shape");
});
