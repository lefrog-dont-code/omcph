# OMCPH - Open Model Context Protocol Host
[![npm version](https://badge.fury.io/js/%40omcph%2Flib.svg)](https://badge.fury.io/js/%40omcph%2Flib) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) <!-- Add build status, etc. badges later -->

**OMCPH** is a robust, embeddable TypeScript client host library for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). It simplifies integrating external AI tools, data sources, and actions into your application (like chatbots, AI agents, or IDE extensions) by discovering, connecting to, and managing multiple MCP servers.

This library focuses *only* on the core TypeScript host functionality.

> **Note:** The HTTP/WebSocket API server is now a separate package: `@omcph/api-server`. If you need an API bridge for non-TypeScript clients, please see the [@omcph/api-server repository](#) (link to be added).

## The Problem

Modern AI applications often need context beyond the immediate chat history. They might need to read files, access databases, run code, or call external APIs. MCP provides a standard way for AI "Hosts" (your application) to communicate with specialized "Servers" that provide these capabilities.

However, managing connections, discovering capabilities across multiple servers, handling different transport protocols (stdio, websockets, etc.), and securely delegating certain tasks (like LLM calls initiated *by* a server) can be complex.

## The Solution

OMCPH acts as a central coordinator within your TypeScript application:

-   **Connects & Manages:** Handles the lifecycle (connection, disconnection, errors) for multiple MCP servers using various transports.
-   **Aggregates Capabilities:** Discovers Tools, Resources (including templates), and Prompts from all connected servers and presents them in unified lists.
-   **Secure Sampling Delegation:** Intercepts `sampling/createMessage` requests *from* servers and emits an event, letting *your main application* perform the actual LLM call using its own logic and API keys.
-   **Event-Driven:** Provides events for server status changes, capability updates, and resource updates.
-   **Simplifies Interaction:** Offers a high-level API (`getTools`, `callTool`, `readResource`, etc.) to interact with the aggregated capabilities.

## Key Features

-   **Multi-Server Management:** Connect to and manage multiple MCP servers simultaneously.
-   **Multi-Transport Support:** Supports connecting via `stdio`, `sse`, `websocket`, and `streamable-http` (MCP 2025-03-26).
-   **Capability Aggregation:** Aggregated lists of Tools, Resources (with `size`), Resource Templates, and Prompts, including server IDs and Tool `annotations`.
-   **Secure Sampling Delegation:** Handles `sampling/createMessage` requests via events, ensuring your app retains control over LLM calls.
-   **Resource Update Notifications:** Subscribe to resource changes and receive `resourceUpdated` events.
-   **Server Suggestion:** Utilities (`suggestServerForUri`, `suggestServerForTool`, etc.) to help select the appropriate server.
-   **Request Options:** Support for progress reporting, timeouts, and cancellation signals on API calls.
-   **Simplified Sampling Handler:** Optional simplified API for handling sampling requests.
-   **Typed Interface:** Built with TypeScript for robust integration.
-   **Robust Error Handling:** Custom `McpHostError` and `AggregateError` types.

## Installation

```bash
npm install @omcph/lib @modelcontextprotocol/sdk
# or
yarn add @omcph/lib @modelcontextprotocol/sdk
# or
pnpm add @omcph/lib @modelcontextprotocol/sdk
```

**Note:** `@modelcontextprotocol/sdk` is a required peer dependency.

## Quick Start

```typescript
import {
  McpClientHost,
  McpHostConfig,
  StdioServerConfig,
  McpError,
  ErrorCode,
  CreateMessageResult,
  // Import types as needed
} from "@omcph/lib"; // or specific path if needed

// 1. Define Configuration
const hostConfig: McpHostConfig = {
  // Identify your application
  hostInfo: { name: "MyAwesomeChatApp", version: "1.2.0" },
  // Define capabilities your app supports (e.g., handling sampling requests)
  hostCapabilities: {
    sampling: {}, // CRITICAL: Tells servers this host can handle LLM calls
    roots: { listChanged: true }, // Example: If your app manages workspace roots
  },
  // List the MCP servers to connect to
  servers: [
    {
      id: "filesystem", // Unique ID for this server connection
      transport: "stdio",
      command: "npx", // Command to run the server
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem", // Example server package
        "/path/to/accessible/directory", // Path accessible by the server process
      ],
    } as StdioServerConfig,
    // Add more servers (stdio, websocket, streamable-http) here
  ],
};

// 2. Instantiate the Host
const host = new McpClientHost(hostConfig);

// 3. Set up Event Listeners (Essential for Sampling)

// __* IMPORTANT: Handle Sampling Requests __*
// Your application MUST implement this listener if hostCapabilities.sampling is enabled.
host.on("samplingRequest", async (serverId, requestParams, callback) => {
  console.log(`⏳ Received sampling request from server: ${serverId}`);
  try {
    // --- YOUR APPLICATION'S LLM CALL LOGIC GOES HERE ---
    // Use requestParams (messages, modelPreferences, etc.) to call your LLM
    const llmApiResponse = await callYourMainLLM(requestParams);
    // Example structure: { modelUsed: "...", role: "assistant", text: "...", stopReason: "..." }
    // --- END LLM CALL LOGIC ---

    // Map the LLM API response to the *required* CreateMessageResult structure
    const result: CreateMessageResult = {
      model: llmApiResponse.modelUsed, // *Required
      role: llmApiResponse.role,       // *Required: Must be 'assistant'
      content: { type: "text", text: llmApiResponse.text }, // *Required (Text or Image)
      stopReason: llmApiResponse.stopReason, // *Required
      // usage: llmApiResponse.usage // Optional
    };
    console.log(`✅ Sending sampling result back to ${serverId}`);
    // Call the callback EXACTLY ONCE with the result
    callback(result);
  } catch (error: any) {
    console.error(`❌ Error processing sampling request for ${serverId}:`, error);
    // Call the callback EXACTLY ONCE with an McpError on failure
    callback(
      new McpError(
        ErrorCode.InternalError, // Or a more specific code
        `LLM interaction failed: ${error.message}`
      )
    );
  }
});

// Optional: Listen to other events
host.on("serverConnected", (serverId) => {
  console.log(`✅ MCP Server Connected: ${serverId}`);
});

host.on("serverDisconnected", (serverId, error) => {
  console.log(`🔌 MCP Server Disconnected: ${serverId}`, error ? `Reason: ${error.message}` : "");
});

host.on("capabilitiesUpdated", () => {
  console.log("✨ Available MCP Capabilities Updated:");
  const tools = host.getTools();
  console.log(`   Tools: ${tools.map(t => `${t.serverId}/${t.name}`).join(", ")}`);
});

host.on("log", (level, message, data) => {
  console.log(`[OMCPH Log - ${level.toUpperCase()}] ${message}`, data || "");
});


// Dummy function placeholder - REPLACE THIS with your actual LLM interaction logic
async function callYourMainLLM(params: any): Promise<any> {
  console.log("Simulating LLM call with messages:", params.messages);
  await new Promise(res => setTimeout(res, 200)); // Simulate delay
  return {
    modelUsed: "simulated-llm-v1",
    role: "assistant",
    text: "This is the simulated LLM response.",
    stopReason: "endTurn",
  };
}

// 4. Start the Host
async function startHost() {
  try {
    console.log("Starting OMCPH Host...");
    await host.start();
    console.log("OMCPH Host started. Waiting for connections...");

    // Your application logic can now use host.getTools(), host.callTool(), etc.

  } catch (error) {
    console.error("Error starting OMCPH Host:", error);
  }
}

// 5. Ensure Graceful Shutdown
async function stopHost() {
  console.log("\nShutting down OMCPH Host...");
  await host.stop();
  console.log("OMCPH Host stopped.");
}

process.on('SIGINT', async () => {
  await stopHost();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await stopHost();
  process.exit(0);
});

// Start the host
startHost();

// Example: Keep the process running (replace with your app's main loop)
// setInterval(() => {}, 1000 * 60 * 60);
```

## Core Concepts

-   **MCP Host (OMCPH):** This library. Lives within your application, manages connections.
-   **MCP Server:** External processes/services providing capabilities (e.g., `@modelcontextprotocol/server-filesystem`). OMCPH connects *to* these.
-   **MCP Client:** Underlying SDK component used internally by OMCPH to handle protocol details for *each* server connection.

OMCPH acts as the manager and aggregator. The actual AI logic (deciding which tool to use, interpreting results) resides in *your application*.

## API Overview

OMCPH provides methods to:

-   Start/Stop the host: `start()`, `stop()`
-   Access aggregated capabilities: `getTools()`, `getResources()`, `getResourceTemplates()`, `getPrompts()`
-   Interact with specific servers: `callTool()`, `readResource()`, `getPrompt()`
-   Manage workspace context: `setRoots()`, `getCurrentRoots()`
-   Subscribe to resource changes: `subscribeToResource()`, `unsubscribeFromResource()`
-   Suggest servers: `suggestServerForUri()`, `suggestServerForTool()`, `suggestServerForPrompt()`
-   Simplify sampling: `setSamplingHandler()` (alternative to the `samplingRequest` event)

See the [Core Library Documentation](./docs/omcph-core.md) for full details.

## Event Handling

OMCPH is event-driven. Key events include:

-   `serverConnected` / `serverDisconnected` / `serverError`: Monitor server status.
-   `capabilitiesUpdated`: Refresh your application's knowledge of available tools/resources/prompts.
-   `resourceUpdated`: React to changes in subscribed resources.
-   `log`: Receive logs from the host and connected servers.
-   **`samplingRequest`:** **Crucial** to handle if your `hostCapabilities` include `sampling`. This delegates LLM calls initiated by servers back to your application.

See the [Core Library Documentation](./docs/omcph-core.md) for details on all events.

## Error Handling

OMCPH uses custom error types:

-   `McpHostError`: For errors specific to the host's operation (e.g., connection failure, server not found). Includes an error `code` and optional `serverId`.
-   `AggregateError`: Thrown by operations like `setRoots` if multiple servers fail, containing an array of `McpHostError` instances.
-   `McpError`: Re-thrown from the underlying `@modelcontextprotocol/sdk` for protocol-level errors during operations like `callTool`.

See the [Core Library Documentation](./docs/omcph-core.md) for more details.

## Configuration

The host is configured via the `McpHostConfig` object passed to the constructor, defining host identity, capabilities, and server connection details (including transport types and parameters).

See the [Core Library Documentation](./docs/omcph-core.md) for configuration options.

## Related Packages

-   **`@modelcontextprotocol/sdk`:** The official MCP TypeScript SDK (required peer dependency).
-   **`@omcph/api-server` ([Link TBD]):** A separate package providing an HTTP/WebSocket API server built on `@omcph/lib`, allowing non-TypeScript applications to leverage MCP servers via this host.


## License

[MIT](./LICENSE)
