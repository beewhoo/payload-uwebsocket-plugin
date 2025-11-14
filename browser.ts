import type { Config } from "payload";

/**
 * Browser-safe mock for the uWebSocket plugin
 * This file is used when bundling for the browser (e.g., Payload admin panel)
 * The actual WebSocket server only runs on the server side
 */
export const uWebSocketPlugin =
  () =>
  (config: Config): Config => {
    // Return config unchanged - WebSocket server is server-side only
    return config;
  };

/**
 * Browser-safe mock for initUWebSocket
 * Does nothing in browser environment
 */
export const initUWebSocket = async (port?: number): Promise<void> => {
  // No-op in browser
  console.warn(
    "initUWebSocket called in browser environment - this is a no-op"
  );
};

/**
 * Browser-safe mock for getUWebSocketManager
 * Returns null in browser environment
 */
export const getUWebSocketManager = (): null => {
  return null;
};

