import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * Clippy's model runs here, off the main thread: web-llm's worker handler answers the engine messages that
 * `webLlmEngineFactory` sends. Spawned with `new Worker(new URL("./llmWorker.ts", import.meta.url))`, so Vite
 * bundles it apart from the desktop; nothing imports this file statically (tests/fuseos-lazy.test.ts).
 */
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message);
};
