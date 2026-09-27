import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { RedisStore } from "@/lib/store/redis-store";

/**
 * What the store actually puts on the wire.
 *
 * The unit test beside this one covers the URL parsing; this one covers the
 * consequence, because the bug it guards against was a *missing command*
 * rather than a wrong value. With `redis://PASSWORD@host` — the form
 * `fly redis status` prints — no AUTH was sent at all. The socket opened
 * normally, so startup looked healthy, and the failure only surfaced later as
 * NOAUTH on every command, by which point the shared store had already been
 * selected over the in-memory fallback.
 *
 * A fake RESP server is used rather than a real Redis: the assertion is about
 * which commands are sent and in what order, which needs no Redis semantics,
 * and it keeps the suite free of a service dependency.
 */

type FakeRedis = {
  port: number;
  commands: string[][];
  close: () => Promise<void>;
};

/** Accepts one client, records RESP arrays, answers +OK (or $-1 for GET). */
function fakeRedis(): Promise<FakeRedis> {
  const commands: string[][] = [];
  // net.Server#close waits for live connections to end, so the sockets have to
  // be destroyed explicitly or teardown hangs until the hook times out.
  const sockets = new Set<net.Socket>();

  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");

        for (;;) {
          if (!buffer.startsWith("*")) break;

          const lines = buffer.split("\r\n");
          const argc = Number(lines[0].slice(1));
          // 1 header line + two lines per argument ($len, value).
          const needed = 1 + argc * 2;
          if (lines.length - 1 < needed) break;

          const args: string[] = [];
          for (let i = 0; i < argc; i += 1) args.push(lines[2 + i * 2]);
          commands.push(args);

          buffer = buffer.slice(lines.slice(0, needed).join("\r\n").length + 2);

          socket.write(args[0]?.toUpperCase() === "GET" ? "$-1\r\n" : "+OK\r\n");
        }
      });

      socket.on("error", () => {});
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        commands,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            server.close(() => done());
          }),
      });
    });
  });
}

let server: FakeRedis | null = null;
let store: RedisStore | null = null;

afterEach(async () => {
  store?.close();
  store = null;
  await server?.close();
  server = null;
});

async function commandsFor(url: (port: number) => string) {
  server = await fakeRedis();
  // RedisStore takes the URL as a string and parses it itself, which is the
  // code path a deployment actually uses.
  store = new RedisStore(url(server.port));
  await store.get("probe");
  return server.commands;
}

describe("AUTH on the wire", () => {
  it("authenticates with the single-credential URL a provider prints", async () => {
    const commands = await commandsFor((port) => `redis://s3cret@127.0.0.1:${port}`);

    const auth = commands.find((c) => c[0]?.toUpperCase() === "AUTH");
    expect(auth, "AUTH must be sent for redis://PASSWORD@host").toBeDefined();
    // One argument: the credential is the password, and two-argument AUTH would
    // need a real ACL user named after the password.
    expect(auth).toEqual(["AUTH", "s3cret"]);
  });

  it("authenticates with an explicit username and password", async () => {
    const commands = await commandsFor((port) => `redis://default:s3cret@127.0.0.1:${port}`);
    expect(commands.find((c) => c[0]?.toUpperCase() === "AUTH")).toEqual([
      "AUTH",
      "default",
      "s3cret",
    ]);
  });

  it("sends no AUTH when the URL carries no credentials", async () => {
    const commands = await commandsFor((port) => `redis://127.0.0.1:${port}`);
    expect(commands.some((c) => c[0]?.toUpperCase() === "AUTH")).toBe(false);
  });

  it("authenticates before issuing any other command", async () => {
    /*
     * Ordering is the whole point: a GET that reaches the server before AUTH
     * is refused, and the store would surface that as a cache miss rather than
     * as a configuration error.
     */
    const commands = await commandsFor((port) => `redis://s3cret@127.0.0.1:${port}`);
    expect(commands[0][0].toUpperCase()).toBe("AUTH");
  });

  it("selects a non-zero database after authenticating, not before", async () => {
    const commands = await commandsFor((port) => `redis://s3cret@127.0.0.1:${port}/3`);
    const names = commands.map((c) => c[0].toUpperCase());

    expect(names[0]).toBe("AUTH");
    expect(names).toContain("SELECT");
    expect(commands.find((c) => c[0].toUpperCase() === "SELECT")).toEqual(["SELECT", "3"]);
    expect(names.indexOf("SELECT")).toBeLessThan(names.indexOf("GET"));
  });
});
