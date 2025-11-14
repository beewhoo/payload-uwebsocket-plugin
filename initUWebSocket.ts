import payload from "payload";
import { UWebSocketManager } from "./uWebSocketManager";

/**
 * Initialize uWebSocket server
 * This should be called after Payload is initialized
 *
 * Note: uWebSockets.js creates its own HTTP server and cannot attach to an existing one.
 * This function will create the WebSocket app and start listening on the specified port.
 *
 * @example
 * ```ts
 * import { initUWebSocket } from './plugins/uwebsocket-plugin';
 *
 * // After payload.init()
 * await payload.init({
 *   secret: process.env.PAYLOAD_SECRET,
 *   express: app,
 * });
 *
 * // Initialize uWebSocket on a separate port
 * await initUWebSocket(3002);
 * ```
 */
export async function initUWebSocket(port: number = 3002): Promise<void> {
  try {
    // Get the socket manager from payload instance
    const socketManager = (payload as any)
      .__uWebSocketManager as UWebSocketManager;

    if (!socketManager) {
      payload.logger.warn(
        "uWebSocket manager not found. Make sure uWebSocketPlugin is configured."
      );
      return;
    }

    // Create the uWebSocket app with all handlers
    socketManager.createApp();

    // Start listening on the specified port
    await socketManager.listen(port);

    payload.logger.info(
      `uWebSocket server initialized successfully on port ${port}`
    );
  } catch (error) {
    payload.logger.error(`Failed to initialize uWebSocket: ${error}`);
    throw error;
  }
}
