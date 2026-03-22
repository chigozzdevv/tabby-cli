import net from "net";
import { buildApp } from "@/app.js";
import { env } from "@/config/env.js";
import { logger } from "@/config/logger.js";
import { startActivitySync } from "@/features/activity/activity.sync.js";

const app = await buildApp();

// Proxy /gateway WebSocket connections to OpenClaw on localhost (trusted, full scopes).
app.server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/gateway") return;
  const target = net.connect(18789, "127.0.0.1", () => {
    const headerLines = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");
    target.write(`GET / HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head?.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  socket.on("error", () => target.destroy());
  target.on("error", () => socket.destroy());
});

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
  logger.info({ port: env.PORT }, "server-started");
  startActivitySync(app);
} catch (error) {
  logger.error({ error }, "server-start-failed");
  process.exit(1);
}
