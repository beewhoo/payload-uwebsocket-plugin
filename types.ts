import { WebSocket } from "uWebSockets.js";
import type { Payload } from "payload";

/**
 * Event types that can be emitted
 */
export type EventType = "create" | "update" | "delete";

/**
 * Payload for real-time events
 */
export interface RealtimeEventPayload {
  /** Type of event */
  type: EventType;
  /** Collection slug */
  collection: string;
  /** Document ID */
  id: string | number;
  /** Document data (for create/update events) */
  doc?: any;
  /** User who triggered the event */
  user?: {
    id: string | number;
    email?: string;
    collection?: string;
  };
  /** Timestamp of the event */
  timestamp: string;
}

/**
 * User data stored in WebSocket
 */
export interface WebSocketUserData {
  user?: {
    id: string | number;
    email?: string;
    collection?: string;
    role?: string;
  };
  id?: string; // Unique socket ID
  rooms?: Set<string>; // Rooms this socket has joined
}

/**
 * WebSocket with authentication and user data
 */
export type AuthenticatedWebSocket = WebSocket<WebSocketUserData>;

/**
 * uWebSocket Manager interface for onSocketConnection callback
 */
export interface UWebSocketManager {
  /**
   * Register a custom message handler for a specific event type
   * This is similar to socket.on() in Socket.IO
   */
  on(
    eventName: string,
    handler: (ws: AuthenticatedWebSocket, data: any) => Promise<void> | void
  ): void;

  /**
   * Send a message to a specific socket
   */
  sendToSocket(ws: AuthenticatedWebSocket, eventName: string, data: any): void;

  /**
   * Broadcast a message to all sockets in a room
   */
  broadcastToRoom(
    roomName: string,
    data: any,
    eventName: string,
    excludeSocketId?: string
  ): void;

  /**
   * Add a socket to a room
   */
  joinRoom(socketId: string, roomName: string): void;

  /**
   * Remove a socket from a room
   */
  leaveRoom(socketId: string, roomName: string): void;

  /**
   * Get all socket IDs in a room
   */
  getSocketsInRoom(roomName: string): string[];

  /**
   * Get all connected sockets
   */
  getSockets(): Map<string, AuthenticatedWebSocket>;
}

/**
 * Authorization handler for a specific collection
 */
export type CollectionAuthorizationHandler = (
  user: any,
  event: RealtimeEventPayload
) => Promise<boolean>;

/**
 * Plugin configuration options
 */
export interface UWebSocketPluginOptions {
  /**
   * Enable/disable the plugin
   * @default true
   */
  enabled?: boolean;

  /**
   * Collections to include for real-time events
   * Only these collections will have real-time events enabled
   * If not provided or empty, no collections will have real-time events
   */
  includeCollections?: string[];

  /**
   * Redis configuration for multi-instance support
   * Uses REDIS_URL environment variable
   */
  redis?: {
    /** Redis connection URL - uses process.env.REDIS_URL */
    url?: string;
  };

  /**
   * uWebSockets.js server options
   */
  uWebSocket?: {
    /** CORS configuration */
    cors?: {
      origin?:
        | string
        | string[]
        | ((
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void
          ) => void);
      credentials?: boolean;
    };
    /** Path for WebSocket endpoint */
    path?: string;
    /** Additional uWebSockets.js server options */
    [key: string]: any;
  };

  /**
   * Custom authentication function
   * If not provided, uses Payload's built-in JWT authentication
   */
  authenticate?: (ws: AuthenticatedWebSocket, payload: any) => Promise<any>;

  /**
   * Authorization handlers per collection
   * Map of collection slug to authorization handler function
   *
   * @example
   * ```ts
   * authorize: {
   *   projects: async (user, event) => {
   *     // Check if user can receive this project event
   *     return user.id === event.doc.user;
   *   },
   *   actors: async (user, event) => {
   *     // Check if user can receive this actor event
   *     return user.id === event.doc.user;
   *   }
   * }
   * ```
   */
  authorize?: {
    [collectionSlug: string]: CollectionAuthorizationHandler;
  };

  /**
   * Event filter function to determine if an event should be emitted
   */
  shouldEmit?: (event: RealtimeEventPayload) => boolean;

  /**
   * Custom event transformer
   */
  transformEvent?: (event: RealtimeEventPayload) => RealtimeEventPayload;

  /**
   * Callback function called when a WebSocket connection is established
   * Use this to register custom event handlers for the socket
   *
   * @example
   * ```ts
   * onSocketConnection: (ws, manager, payload) => {
   *   projectHandlers(ws, manager, payload);
   *   actorHandlers(ws, manager, payload);
   * }
   * ```
   */
  onSocketConnection?: (
    ws: AuthenticatedWebSocket,
    manager: UWebSocketManager,
    payload: any
  ) => void;
}

/**
 * Message types for WebSocket communication
 */
export interface WebSocketMessage {
  type: string;
  data?: any;
}
