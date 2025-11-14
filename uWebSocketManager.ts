import { App, us_listen_socket, TemplatedApp } from "uWebSockets.js";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import payload from "payload";
import {
  UWebSocketPluginOptions,
  AuthenticatedWebSocket,
  RealtimeEventPayload,
  WebSocketMessage,
} from "./types";
import { randomUUID } from "crypto";

/**
 * uWebSocket Manager for handling real-time events with Redis adapter
 * Supports multiple Payload instances for production environments
 */
export class UWebSocketManager {
  private app: TemplatedApp | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private options: UWebSocketPluginOptions;
  private sockets: Map<string, AuthenticatedWebSocket> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // roomName -> Set of socket IDs
  private listenSocket: us_listen_socket | null = null;

  constructor(options: UWebSocketPluginOptions) {
    this.options = options;
  }

  /**
   * Initialize uWebSocket server with Redis adapter
   */
  async init(_server?: any): Promise<TemplatedApp> {
    const { redis } = this.options;

    // Setup Redis adapter for multi-instance support
    if (redis) {
      await this.setupRedisAdapter();
    }

    // Note: uWebSockets.js doesn't attach to existing HTTP server
    // It creates its own server, so we'll need to handle this differently
    // For now, we'll create the app and set up handlers
    // The actual listening will be done separately

    payload.logger.info(
      "uWebSocket server initialized with real-time events plugin"
    );

    return this.app!;
  }

  /**
   * Setup Redis adapter for multi-instance synchronization
   */
  async setupRedisAdapter(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      payload.logger.warn(
        "REDIS_URL not configured. Skipping Redis adapter setup."
      );
      return;
    }

    try {
      this.pubClient = new Redis(redisUrl, {
        keyPrefix: "uwebsocket:",
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      this.subClient = this.pubClient.duplicate();

      await Promise.all([
        new Promise((resolve) => this.pubClient!.once("ready", resolve)),
        new Promise((resolve) => this.subClient!.once("ready", resolve)),
      ]);

      // Subscribe to Redis channels for cross-instance communication
      this.subClient.on("message", (channel, message) => {
        this.handleRedisMessage(channel, message);
      });

      this.subClient.subscribe("uwebsocket:events");

      payload.logger.info(
        "Redis adapter configured for uWebSocket multi-instance support"
      );
    } catch (error) {
      payload.logger.error(`Failed to setup Redis adapter: ${error}`);
      throw error;
    }
  }

  /**
   * Handle messages from Redis (for multi-instance support)
   */
  private handleRedisMessage(channel: string, message: string): void {
    try {
      const data = JSON.parse(message);

      if (data.type === "event") {
        // Broadcast event to local sockets
        this.broadcastToRoom(data.room, data.event, data.eventName);
      } else if (data.type === "room-broadcast") {
        // Broadcast message to room
        this.broadcastToRoom(data.room, data.message, data.eventName);
      }
    } catch (error) {
      payload.logger.error(`Error handling Redis message: ${error}`);
    }
  }

  /**
   * Publish event to Redis for multi-instance support
   */
  private async publishToRedis(
    type: string,
    room: string,
    eventName: string,
    data: any
  ): Promise<void> {
    if (!this.pubClient) return;

    try {
      await this.pubClient.publish(
        "uwebsocket:events",
        JSON.stringify({
          type,
          room,
          eventName,
          event: data,
          message: data,
        })
      );
    } catch (error) {
      payload.logger.error(`Error publishing to Redis: ${error}`);
    }
  }

  /**
   * Create uWebSocket app with all handlers
   */
  createApp(_port: number = 3001): TemplatedApp {
    this.app = App({});

    this.app.ws("/*", {
      /* WebSocket options */
      compression: 1,
      maxPayloadLength: 16 * 1024 * 1024,
      idleTimeout: 60,

      /* Handlers */
      upgrade: (res, req, context) => {
        const url = req.getUrl();
        const query = req.getQuery();

        // Extract token from query string
        const token = this.extractTokenFromQuery(query);

        if (!token) {
          res.cork(() => {
            res
              .writeStatus("401 Unauthorized")
              .end("Authentication token required");
          });
          return;
        }

        // Track if response was aborted
        let aborted = false;
        res.onAborted(() => {
          aborted = true;
        });

        // Copy headers needed for upgrade (must be done before async operations)
        const secWebSocketKey = req.getHeader("sec-websocket-key");
        const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
        const secWebSocketExtensions = req.getHeader(
          "sec-websocket-extensions"
        );

        // Verify token asynchronously
        (async () => {
          try {
            const decoded = jwt.verify(token, payload.secret) as any;

            // Fetch full user document from Payload
            const userDoc = await payload.findByID({
              collection: decoded.collection || "users",
              id: decoded.id,
            });

            if (aborted) return;

            if (!userDoc) {
              res.cork(() => {
                res.writeStatus("401 Unauthorized").end("User not found");
              });
              return;
            }

            const userData = {
              id: userDoc.id,
              email: userDoc.email,
              collection: decoded.collection || "users",
              role: userDoc.role,
            };

            if (aborted) return;

            // Upgrade to WebSocket (must be corked for async operations)
            res.cork(() => {
              res.upgrade(
                {
                  user: userData,
                  id: randomUUID(),
                  rooms: new Set<string>(),
                },
                secWebSocketKey,
                secWebSocketProtocol,
                secWebSocketExtensions,
                context
              );
            });
          } catch (error) {
            if (aborted) return;

            payload.logger.error(`WebSocket authentication error: ${error}`);
            res.cork(() => {
              res
                .writeStatus("401 Unauthorized")
                .end("Invalid authentication token");
            });
          }
        })();
      },

      open: (ws: AuthenticatedWebSocket) => {
        const userData = ws.getUserData();
        const socketId = userData.id!;
        this.sockets.set(socketId, ws);

        payload.logger.info(
          `Client connected: ${socketId}, User: ${
            userData.user?.email || userData.user?.id
          }`
        );

        // Call onSocketConnection callback if provided
        if (this.options.onSocketConnection) {
          payload.logger.info(
            `[uWebSocket] Calling onSocketConnection callback for ${socketId}`
          );
          this.options.onSocketConnection(ws, this, payload);
          payload.logger.info(
            `[uWebSocket] Registered custom handlers: ${Array.from(
              this.customHandlers.keys()
            ).join(", ")}`
          );
        }
      },

      message: async (ws: AuthenticatedWebSocket, message, _isBinary) => {
        try {
          const msg = JSON.parse(
            Buffer.from(message).toString()
          ) as WebSocketMessage;
          await this.handleMessage(ws, msg);
        } catch (error) {
          payload.logger.error(`Error handling WebSocket message: ${error}`);
        }
      },

      close: (
        ws: AuthenticatedWebSocket,
        _code: number,
        _message: ArrayBuffer
      ) => {
        const userData = ws.getUserData();
        const socketId = userData.id!;

        payload.logger.info(
          `Client disconnected: ${socketId}, User: ${
            userData.user?.email || userData.user?.id
          }`
        );

        // Notify all rooms that this user left
        if (userData.rooms) {
          userData.rooms.forEach((room) => {
            if (room.startsWith("project:") && userData.user) {
              this.broadcastToRoom(
                room,
                { userId: userData.user.id },
                "project:user-left",
                socketId
              );
              payload.logger.info(
                `Notified room ${room} that user ${userData.user.id} left`
              );
            } else if (room.startsWith("actor:") && userData.user) {
              this.broadcastToRoom(
                room,
                { userId: userData.user.id },
                "actor:user-left",
                socketId
              );
              payload.logger.info(
                `Notified room ${room} that user ${userData.user.id} left`
              );
            }
            // Remove socket from room
            this.leaveRoom(socketId, room);
          });
        }

        this.sockets.delete(socketId);
      },
    });

    return this.app;
  }

  /**
   * Extract token from query string
   */
  private extractTokenFromQuery(query: string): string | null {
    const params = new URLSearchParams(query);
    return params.get("token");
  }

  /**
   * Helper to get user data from WebSocket
   */
  private getUserData(ws: AuthenticatedWebSocket) {
    return ws.getUserData();
  }

  /**
   * Custom message handlers registered via onSocketConnection
   */
  private customHandlers: Map<
    string,
    (ws: AuthenticatedWebSocket, data: any) => Promise<void> | void
  > = new Map();

  /**
   * Register a custom message handler
   * This is used by onSocketConnection callbacks to register event handlers
   */
  public on(
    eventName: string,
    handler: (ws: AuthenticatedWebSocket, data: any) => Promise<void> | void
  ): void {
    this.customHandlers.set(eventName, handler);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(
    ws: AuthenticatedWebSocket,
    msg: WebSocketMessage
  ): Promise<void> {
    const { type, data } = msg;
    const userData = ws.getUserData();

    payload.logger.info(
      `[uWebSocket] Received message from ${
        userData.id
      }: type="${type}", data=${JSON.stringify(data)}`
    );

    switch (type) {
      case "subscribe":
      case "join-collection":
        await this.handleJoinCollection(ws, data);
        break;

      case "unsubscribe":
        await this.handleUnsubscribe(ws, data);
        break;

      default:
        // Check if there's a custom handler registered for this event
        const customHandler = this.customHandlers.get(type);
        if (customHandler) {
          payload.logger.info(
            `[uWebSocket] Calling custom handler for type="${type}"`
          );
          try {
            await customHandler(ws, data);
          } catch (error) {
            payload.logger.error(
              `Error in custom handler for ${type}: ${error}`
            );
          }
        } else {
          payload.logger.warn(
            `[uWebSocket] Unknown message type: ${type}, available custom handlers: ${Array.from(
              this.customHandlers.keys()
            ).join(", ")}`
          );
        }
    }
  }

  /**
   * Handle join-collection event
   */
  private async handleJoinCollection(
    ws: AuthenticatedWebSocket,
    collection: string | string[]
  ): Promise<void> {
    const userData = this.getUserData(ws);
    const collections = Array.isArray(collection) ? collection : [collection];

    collections.forEach((coll) => {
      const roomName = `collection:${coll}`;
      this.joinRoom(userData.id!, roomName);
      userData.rooms!.add(roomName);
      payload.logger.info(
        `Client ${userData.id} (${userData.user?.email}) joined collection room: ${roomName}`
      );
    });
  }

  /**
   * Handle unsubscribe event
   */
  private async handleUnsubscribe(
    ws: AuthenticatedWebSocket,
    collection: string | string[]
  ): Promise<void> {
    const userData = this.getUserData(ws);
    const collections = Array.isArray(collection) ? collection : [collection];

    collections.forEach((coll) => {
      const roomName = `collection:${coll}`;
      this.leaveRoom(userData.id!, roomName);
      userData.rooms!.delete(roomName);
      payload.logger.info(
        `Client ${userData.id} (${userData.user?.email}) left collection room: ${roomName}`
      );
    });
  }

  /**
   * Join a room
   */
  public joinRoom(socketId: string, roomName: string): void {
    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Set());
    }
    this.rooms.get(roomName)!.add(socketId);
  }

  /**
   * Leave a room
   */
  public leaveRoom(socketId: string, roomName: string): void {
    const room = this.rooms.get(roomName);
    if (room) {
      room.delete(socketId);
      if (room.size === 0) {
        this.rooms.delete(roomName);
      }
    }
  }

  /**
   * Get all socket IDs in a room
   */
  public getSocketsInRoom(roomName: string): string[] {
    const room = this.rooms.get(roomName);
    return room ? Array.from(room) : [];
  }

  /**
   * Get all sockets
   */
  public getSockets(): Map<string, AuthenticatedWebSocket> {
    return this.sockets;
  }

  /**
   * Send message to a specific socket
   */
  public sendToSocket(
    ws: AuthenticatedWebSocket,
    eventName: string,
    data: any
  ): void {
    try {
      const message = JSON.stringify({
        type: eventName,
        data,
      });
      (ws as any).send(message, false);
    } catch (error) {
      payload.logger.error(`Error sending message to socket: ${error}`);
    }
  }

  /**
   * Broadcast message to all sockets in a room (except sender)
   */
  public broadcastToRoom(
    roomName: string,
    data: any,
    eventName: string,
    excludeSocketId?: string
  ): void {
    const socketIds = this.getSocketsInRoom(roomName);

    socketIds.forEach((socketId) => {
      if (excludeSocketId && socketId === excludeSocketId) {
        return; // Skip the sender
      }

      const socket = this.sockets.get(socketId);
      if (socket) {
        this.sendToSocket(socket, eventName, data);
      }
    });

    // Also publish to Redis for multi-instance support
    this.publishToRedis("room-broadcast", roomName, eventName, data);
  }

  /**
   * Emit a real-time event to all connected clients
   */
  async emitEvent(event: RealtimeEventPayload): Promise<void> {
    const { authorize, shouldEmit, transformEvent } = this.options;

    // Check if event should be emitted
    if (shouldEmit && !shouldEmit(event)) {
      return;
    }

    // Transform event if transformer is provided
    const finalEvent = transformEvent ? transformEvent(event) : event;

    // Emit to collection-specific room
    const room = `collection:${event.collection}`;

    // If authorization is required, emit to each socket individually
    if (authorize) {
      // Get the handler for this collection
      const collectionHandler = authorize[event.collection];

      if (collectionHandler) {
        const socketIds = this.getSocketsInRoom(room);

        for (const socketId of socketIds) {
          const socket = this.sockets.get(socketId);
          const socketData = this.getUserData(socket);
          if (socketData.user) {
            const isAuthorized = await collectionHandler(
              socketData.user,
              finalEvent
            );
            if (isAuthorized) {
              this.sendToSocket(socket, "payload:event", finalEvent);
            }
          }
        }
      }
      // If no handler for this collection, don't emit (deny by default)
    } else {
      // No authorization configured - emit to all sockets in the room
      this.broadcastToRoom(room, finalEvent, "payload:event");
    }

    // Also emit to a global event for clients listening to all events
    const allSocketIds = Array.from(this.sockets.keys());
    allSocketIds.forEach((socketId) => {
      const socket = this.sockets.get(socketId);
      if (socket) {
        this.sendToSocket(socket, "payload:event:all", finalEvent);
      }
    });

    // Publish to Redis for multi-instance support
    await this.publishToRedis("event", room, "payload:event", finalEvent);
  }

  /**
   * Listen on a specific port
   */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.app) {
        reject(new Error("App not initialized. Call createApp() first."));
        return;
      }

      this.app.listen(port, (listenSocket) => {
        if (listenSocket) {
          this.listenSocket = listenSocket;
          payload.logger.info(`uWebSocket server listening on port ${port}`);
          resolve();
        } else {
          reject(new Error(`Failed to listen on port ${port}`));
        }
      });
    });
  }

  /**
   * Get the app instance
   */
  getApp(): TemplatedApp | null {
    return this.app;
  }

  /**
   * Cleanup and close connections
   */
  async close(): Promise<void> {
    if (this.listenSocket) {
      // Close the listening socket
      // Note: uWebSockets.js doesn't have a direct close method
      // We need to use us_listen_socket_close from the native module
      payload.logger.info("Closing uWebSocket server");
    }

    if (this.pubClient) {
      await this.pubClient.quit();
    }

    if (this.subClient) {
      await this.subClient.quit();
    }

    this.sockets.clear();
    this.rooms.clear();

    payload.logger.info("uWebSocket server closed");
  }
}
