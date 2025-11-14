# uWebSocket Plugin for Payload CMS

A high-performance WebSocket plugin for Payload CMS using [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js), providing real-time event broadcasting with Redis support for multi-instance deployments.

## Features

- ✅ **High Performance** - Built on uWebSockets.js, one of the fastest WebSocket implementations
- ✅ **JWT Authentication** - Secure WebSocket connections using Payload's authentication
- ✅ **Redis Pub/Sub** - Multi-instance support for horizontal scaling
- ✅ **Room-based Broadcasting** - Subscribe to specific collections or custom rooms
- ✅ **Authorization Handlers** - Per-collection authorization logic
- ✅ **Custom Message Handlers** - Extend with your own WebSocket message types
- ✅ **Automatic Hooks** - Integrates with Payload's afterChange and afterDelete hooks
- ✅ **TypeScript Support** - Full type definitions included

## Architecture

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                         │
│  WebSocket Connection: ws://localhost:3002?token=<JWT_TOKEN>    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    uWebSocket Server (Port 3002)                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Authentication Layer (JWT Verification)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  WebSocket Handlers                                       │  │
│  │  • upgrade - Authenticate connection                      │  │
│  │  • open - Register socket                                 │  │
│  │  • message - Handle client messages                       │  │
│  │  • close - Cleanup on disconnect                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Room Manager                                             │  │
│  │  • Collection Rooms: "collection:posts"                   │  │
│  │  • Custom Rooms: "room:custom-id"                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Redis Pub/Sub (Optional)                    │
│  Synchronizes events across multiple server instances           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Payload CMS Hooks                        │
│  • afterChange - Emit 'update' events                           │
│  • afterDelete - Emit 'delete' events                           │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

Install the plugin via npm:

```bash
npm install payload-uwebsocket-plugin
```

The plugin has the following dependencies:

- `uWebSockets.js` - High-performance WebSocket server
- `ioredis` - Redis client for multi-instance support
- `jsonwebtoken` - JWT authentication

Peer dependency:

- `payload` - ^2.0.0 || ^3.0.0 (tested with v2.30.1 and v3.64.0)

## Configuration

### 1. Add Plugin to Payload Config

```typescript
import { buildConfig } from "payload";
import { uWebSocketPlugin } from "payload-uwebsocket-plugin";

export default buildConfig({
  // ... other config
  plugins: [
    uWebSocketPlugin({
      enabled: true,
      includeCollections: ["posts", "users", "media"], // Collections to enable real-time events for
      redis: process.env.REDIS_URL
        ? {
            url: process.env.REDIS_URL,
          }
        : undefined,
      authorize: {
        // Optional: Add authorization handlers per collection
        posts: async (user, event) => {
          // Return true if user can receive updates about this document
          // Example: Only send updates for published posts or posts owned by user
          return (
            event.doc.status === "published" || event.doc.author === user.id
          );
        },
      },
    }),
  ],
});
```

### 2. Initialize WebSocket Server

In your server file (e.g., `server.ts`):

```typescript
import express from "express";
import payload from "payload";
import { initUWebSocket } from "payload-uwebsocket-plugin";

const app = express();

// Initialize Payload
await payload.init({
  secret: process.env.PAYLOAD_SECRET!,
  express: app,
});

// Initialize uWebSocket server on a separate port
await initUWebSocket(3002);

// Start Express server
app.listen(3000, () => {
  console.log("Payload running on http://localhost:3000");
  console.log("WebSocket running on ws://localhost:3002");
});
```

### 3. Environment Variables

```bash
# Optional: Redis URL for multi-instance support
REDIS_URL=redis://localhost:6379
```

## Client Usage

### Connecting to WebSocket

```typescript
// Get JWT token from Payload authentication
const token = localStorage.getItem("payload-token");

// Connect to WebSocket server
const ws = new WebSocket(`ws://localhost:3002?token=${token}`);

ws.onopen = () => {
  console.log("Connected to WebSocket");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received:", message);
};
```

### Subscribing to Collection Updates

```typescript
// Subscribe to posts collection updates
ws.send(
  JSON.stringify({
    type: "join-collection",
    collection: "posts",
  })
);

// Listen for updates
ws.onmessage = (event) => {
  const { type, collection, doc } = JSON.parse(event.data);

  if (type === "update" && collection === "posts") {
    console.log("Post updated:", doc);
    // Update your UI with the new data
  }

  if (type === "delete" && collection === "posts") {
    console.log("Post deleted:", doc.id);
    // Remove from your UI
  }
};
```

### Unsubscribing from Collection

```typescript
ws.send(
  JSON.stringify({
    type: "leave-collection",
    collection: "posts",
  })
);
```

## How Events Flow

### 1. Document Update Flow

```
User updates document in Payload CMS
         ↓
Payload afterChange hook fires
         ↓
uWebSocketManager.emitEvent() called
         ↓
Authorization handler checks permissions (if configured)
         ↓
Event published to Redis (if configured)
         ↓
All connected clients in collection room receive update
```

### 2. Custom Room Flow

```
Client sends custom message (e.g., 'join-room')
         ↓
Custom message handler processes request
         ↓
User added to custom room
         ↓
Server can broadcast to all users in room
```

## API Reference

### Plugin Options

```typescript
interface UWebSocketPluginOptions {
  enabled: boolean; // Enable/disable the plugin
  includeCollections?: string[]; // Collections to track
  redis?: {
    url: string; // Redis connection URL
  };
  authorize?: {
    [collection: string]: (user: any, event: any) => Promise<boolean>;
  };
}
```

### Client Message Types

- `join-collection` - Subscribe to collection updates
- `leave-collection` - Unsubscribe from collection updates
- Custom types can be added via message handlers

### Server Event Types

- `update` - Document was updated
- `delete` - Document was deleted
- Custom events can be emitted via the manager

## Redis Multi-Instance Support

When Redis is configured, the plugin synchronizes events across multiple server instances:

```
Instance 1                    Redis                    Instance 2
    │                           │                           │
    │  Document updated         │                           │
    ├──────────────────────────►│                           │
    │  Publish to channel       │                           │
    │                           ├──────────────────────────►│
    │                           │  Subscribe receives event │
    │                           │                           │
    │                           │  Broadcast to clients ────┤
```

This ensures that clients connected to different server instances receive the same events.

## Development vs Production

### Development (Single Instance)

```typescript
uWebSocketPlugin({
  enabled: true,
  includeCollections: ["posts", "users"],
  // No Redis needed for single instance
});
```

### Production (Multi-Instance)

```typescript
uWebSocketPlugin({
  enabled: true,
  includeCollections: ["posts", "users"],
  redis: {
    url: process.env.REDIS_URL, // Required for multi-instance
  },
});
```

## Advanced Usage

### Custom Message Handlers

You can add custom WebSocket message handlers:

```typescript
import { getUWebSocketManager } from "payload-uwebsocket-plugin";

// After initializing the WebSocket server
const manager = getUWebSocketManager();

manager.registerCustomHandler("custom-action", async (ws, data) => {
  // Handle custom message type
  console.log("Custom action received:", data);

  // Send response back to client
  manager.sendToSocket(ws, {
    type: "custom-response",
    data: { success: true },
  });
});
```

### Broadcasting to Custom Rooms

```typescript
const manager = getUWebSocketManager();

// Broadcast to all clients in a custom room
manager.broadcastToRoom("room:custom-id", {
  type: "notification",
  message: "Hello everyone!",
});
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT © [Bibek Thapa](https://github.com/beewhoo)

## Support

For any questions or issues, please [open an issue](https://github.com/beewhoo/payload-uwebsocket-plugin/issues).
