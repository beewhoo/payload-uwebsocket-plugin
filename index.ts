import { UWebSocketManager } from "./uWebSocketManager";
import { UWebSocketPluginOptions, RealtimeEventPayload } from "./types";
import type { Config } from "payload";

/**
 * Payload CMS Plugin for Real-time Events using uWebSockets.js
 *
 * This plugin enables real-time event broadcasting for collection changes
 * using uWebSockets.js with Redis adapter for multi-instance support.
 *
 * @example
 * ```ts
 * import { uWebSocketPlugin } from './plugins/uwebsocket-plugin';
 *
 * export default buildConfig({
 *   plugins: [
 *     uWebSocketPlugin({
 *       enabled: true,
 *       redis: {
 *         url: process.env.REDIS_URL,
 *       },
 *       uWebSocket: {
 *         cors: {
 *           origin: ['http://localhost:3000'],
 *           credentials: true,
 *         },
 *       },
 *       includeCollections: ['projects', 'actors'],
 *       authorize: {
 *         projects: async (user, event) => {
 *           // Your authorization logic
 *           return user.id === event.doc.user;
 *         }
 *       }
 *     }),
 *   ],
 * });
 * ```
 */
export const uWebSocketPlugin = (
  pluginOptions: UWebSocketPluginOptions = {}
) => {
  return (incomingConfig: Config): Config => {
    // Default options
    const options: UWebSocketPluginOptions = {
      enabled: true,
      includeCollections: [],
      ...pluginOptions,
    };

    // If plugin is disabled, return config unchanged
    if (options.enabled === false) {
      return incomingConfig;
    }

    const socketManager = new UWebSocketManager(options);

    /**
     * Helper function to check if events should be emitted for a collection
     */
    const shouldEmitForCollection = (collectionSlug: string): boolean => {
      // Only emit for collections explicitly included
      if (options.includeCollections && options.includeCollections.length > 0) {
        return options.includeCollections.includes(collectionSlug);
      }
      // If no collections specified, don't emit for any
      return false;
    };

    /**
     * Create event payload from hook arguments
     */
    const createEventPayload = (
      type: "create" | "update" | "delete",
      collection: string,
      args: any
    ): RealtimeEventPayload => {
      return {
        type,
        collection,
        id: args.doc?.id || args.id,
        doc: type === "delete" ? undefined : args.doc,
        user: args.req?.user
          ? {
              id: args.req.user.id,
              email: args.req.user.email,
              collection: args.req.user.collection,
            }
          : undefined,
        timestamp: new Date().toISOString(),
      };
    };

    /**
     * Add hooks to collections
     */
    const collectionsWithHooks =
      incomingConfig.collections?.map((collection) => {
        // Skip if events should not be emitted for this collection
        if (!shouldEmitForCollection(collection.slug)) {
          return collection;
        }

        return {
          ...collection,
          hooks: {
            ...collection.hooks,
            // After change hook - only emit for updates
            afterChange: [
              ...(collection.hooks?.afterChange || []),
              async (args: any) => {
                try {
                  // Only emit events for updates, not creates
                  if (args.operation !== "update") {
                    return;
                  }

                  const event = createEventPayload(
                    "update",
                    collection.slug,
                    args
                  );
                  await socketManager.emitEvent(event);
                } catch (error) {
                  console.error(
                    `Error emitting update event for ${collection.slug}:`,
                    error
                  );
                }
              },
            ],
            // After delete hook
            afterDelete: [
              ...(collection.hooks?.afterDelete || []),
              async (args: any) => {
                try {
                  const event = createEventPayload(
                    "delete",
                    collection.slug,
                    args
                  );
                  await socketManager.emitEvent(event);
                } catch (error) {
                  console.error(
                    `Error emitting delete event for ${collection.slug}:`,
                    error
                  );
                }
              },
            ],
          },
        };
      }) || [];

    /**
     * Add onInit hook to store socket manager
     */
    const onInit = async (payload: any) => {
      // Call original onInit if it exists
      if (incomingConfig.onInit) {
        await incomingConfig.onInit(payload);
      }

      // Store the socket manager for later initialization
      // The WebSocket server will be initialized in server.ts using initUWebSocket()
      payload.__uWebSocketManager = socketManager;
    };

    return {
      ...incomingConfig,
      collections: collectionsWithHooks,
      onInit,
    };
  };
};

// Export types for external use
export * from "./types";
export { UWebSocketManager } from "./uWebSocketManager";
export { initUWebSocket } from "./initUWebSocket";
