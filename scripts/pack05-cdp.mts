/**
 * PACK-05 helper: CDP evaluate against installed Launcher (remote-debugging-port).
 * Usage: pnpm exec tsx scripts/pack05-cdp.mts <JS expression>
 */
const port = Number(process.env.PACK05_CDP_PORT ?? "9333");
const expr = process.argv.slice(2).join(" ").trim();
if (!expr) {
  console.error("usage: pack05-cdp.mts <JS expression returning value/Promise>");
  process.exit(2);
}

const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
  type: string;
  webSocketDebuggerUrl?: string;
}>;
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page?.webSocketDebuggerUrl) {
  console.error("no page target on CDP");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  ws.addEventListener("open", () => resolve());
  ws.addEventListener("error", (ev) => reject(ev));
});

let nextId = 1;
function cdp<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        result?: T;
        error?: { message: string };
      };
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result as T);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp("Runtime.enable");
const result = await cdp<{
  result: { type: string; value?: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}>("Runtime.evaluate", {
  expression: `(async () => (${expr}))()`,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true
});

if (result.exceptionDetails) {
  console.error(
    result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
  );
  process.exit(1);
}

console.log(JSON.stringify(result.result.value ?? result.result, null, 2));
ws.close();
