// Runs before `npm run dev`. If something is already using the ports the app needs, say exactly what
// and how to stop it, instead of letting the app start half-broken (a classic cause of "Disconnected").
import { execSync } from "node:child_process";
import net from "node:net";

const PORTS = [
  { port: Number(process.env.PORT ?? 3000), name: "API" },
  { port: 5173, name: "web app" },
];

const isFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });

/** Best effort: who is listening on this port? Returns "" when it can't tell. */
function whoHas(port) {
  try {
    if (process.platform === "win32") {
      const line = execSync(`netstat -ano -p tcp`, { encoding: "utf8" })
        .split(/\r?\n/)
        .find((l) => l.includes("LISTENING") && new RegExp(`:${port}\\s`).test(l));
      const pid = line?.trim().split(/\s+/).pop();
      return pid ? { pid, stop: `taskkill /PID ${pid} /T /F` } : "";
    }
    const pid = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" }).split("\n")[0];
    return pid ? { pid, stop: `kill ${pid}` } : "";
  } catch {
    return "";
  }
}

let blocked = false;
for (const { port, name } of PORTS) {
  if (await isFree(port)) continue;
  blocked = true;
  const owner = whoHas(port);
  console.error(`\nPort ${port} (needed by the ${name}) is already in use.`);
  console.error(
    owner
      ? `  Process ${owner.pid} is using it. If it is an old copy of this app, stop it with:\n    ${owner.stop}`
      : "  Another program, or an old copy of this app, is using it. Stop it and try again.",
  );
}
if (blocked) {
  console.error("\nNothing was started. Free the port(s) above, then run `npm run dev` again.\n");
  process.exit(1);
}
