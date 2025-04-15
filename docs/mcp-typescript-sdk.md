Okay, here is the third document, focusing specifically on **how to use the MCP TypeScript SDK** with practical examples and best practices. This complements the conceptual and comprehensive guides.

--- START OF FILE mcp-typescript-sdk-usage.md ---

> **Note:** If you are looking for an HTTP/WebSocket API server bridge for OMCPH, it is now a separate package: `omcph-api-server`. See the [omcph-api-server repository](#) (link to be added).

# MCP TypeScript SDK: Practical Usage Guide

## 1. Introduction

This guide provides practical examples and best practices for using the Model Context Protocol (MCP) TypeScript SDK (`@modelcontextprotocol/sdk`). It assumes you have a basic understanding of MCP concepts (Host, Server, Client, Resources, Tools, Prompts) as outlined in the [MCP Conceptual Guide](./mcp-conceptual.md) and potentially the [Comprehensive Guide](./mcp-typescript-synthesized.md).

**Goal:** To show *how* to implement common MCP patterns using the specific classes and methods provided by the TypeScript SDK.

## 2. Installation

```bash
npm install @modelcontextprotocol/sdk zod
# or
yarn add @modelcontextprotocol/sdk zod
# or
pnpm add @modelcontextprotocol/sdk zod
```

Using `zod` is highly recommended for defining and validating tool input schemas.

## 3. Building MCP Servers

Servers expose capabilities (Resources, Tools, Prompts) to connected Clients.

### 3.1 Server Initialization

Use the `McpServer` class. Define its identity and *all* capabilities it supports upfront.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "my-weather-server",
  version: "1.1.0",
  // Declare ALL capabilities this server will offer
  capabilities: {
    tools: { listChanged: false }, // This server only offers tools
    // resources: {}, // Not offering resources
    // prompts: {}, // Not offering prompts
    // logging: {}, // Not sending logs via notifications/message
    // completions: {}, // Not offering argument completions
  },
});

// Later, connect a transport...
// const transport = new StdioServerTransport();
// await server.connect(transport);
```

### 3.2 Defining Tools

Use `server.tool()` to define each tool. Provide a name, description, a `zod` schema for input validation, the execution handler, and optional annotations.

```typescript
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Define input schema using Zod
const getWeatherSchema = z.object({
  location: z.string().describe("City name or zip code"),
  unit: z.enum(["C", "F"]).optional().default("C").describe("Temperature unit (Celsius or Fahrenheit)"),
});

// Define the tool
server.tool(
  "get_weather", // Unique tool name
  "Fetches the current weather for a specified location.", // Description for LLM/Host
  getWeatherSchema, // Zod schema for input validation
  // Async handler function - receives validated arguments
  async (args): Promise<CallToolResult> => {
    console.error(`[Server] Executing get_weather for: ${args.location} (${args.unit})`);
    try {
      // --- Your tool logic here ---
      // Example: Call an external weather API
      const weatherData = await fetchWeatherFromAPI(args.location, args.unit);
      // --- End tool logic ---

      // Return successful result
      return {
        isError: false, // Indicate success
        content: [{ type: "text", text: weatherData }],
      };
    } catch (error: any) {
      console.error(`[Server] Error in get_weather: ${error.message}`);
      // Return a tool execution error (not a protocol error)
      return {
        isError: true, // Indicate failure
        content: [{ type: "text", text: `Failed to get weather: ${error.message}` }],
      };
    }
  },
  // Optional annotations
  {
    title: "Get Current Weather", // User-friendly title for UI
    readOnlyHint: true, // This tool doesn't change state
    openWorldHint: true, // Interacts with external service
  }
);

// Dummy function for example
async function fetchWeatherFromAPI(location: string, unit: string): Promise<string> {
  // Replace with actual API call
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate network delay
  if (location.toLowerCase() === "error") throw new Error("Simulated API error");
  const temp = unit === "C" ? 20 : 68;
  return `Weather in ${location}: ${temp}°${unit}, Sunny.`;
}
```

**Best Practices (Tools):**

*   Use descriptive names and clear descriptions for the LLM.
*   Use `zod` for robust input validation. The handler receives typed, validated `args`.
*   Return `isError: true` for failures *within* the tool's logic (e.g., API failure). Throwing an `Error` from the handler signals a *protocol* or *server* level problem.
*   Keep tool logic focused.
*   Use annotations to help Hosts provide better user context during HITL.

### 3.3 Defining Resources

Use `server.resource()` for statically defined resources or `server.resourceTemplate()` for dynamic ones. Provide the resource definition and a handler to read its content.

```typescript
import { ResourceContent } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

// --- Static Resource Example ---
const staticResourceUri = "docs:///readme.md";
const staticFilePath = path.resolve("./server-docs/readme.md"); // Securely resolve path

server.resource(
  {
    uri: staticResourceUri,
    name: "Server README",
    description: "General information about this server.",
    mimeType: "text/markdown",
  },
  // Async handler function - receives ReadResourceRequest
  async (req): Promise<ResourceContent[]> => {
    console.error(`[Server] Reading resource: ${req.uri}`);
    try {
      const content = await fs.readFile(staticFilePath, "utf-8");
      return [{ uri: staticResourceUri, mimeType: "text/markdown", text: content }];
    } catch (error: any) {
      console.error(`[Server] Error reading resource ${staticResourceUri}: ${error.message}`);
      throw new Error(`Resource not found: ${staticResourceUri}`); // Throw for protocol error
    }
  }
);

// --- Resource Template Example ---
server.resourceTemplate(
  {
    uriTemplate: "file:///{filePath}", // URI template with variable
    name: "Workspace File",
    description: "Access a specific file within the allowed workspace.",
    mimeType: "application/octet-stream", // Generic, refine in handler if possible
    // Define arguments for the template (optional but good practice)
    arguments: [{ name: "filePath", description: "Relative path to the file", required: true }],
  },
  // Async handler function - receives ReadResourceRequest with expanded URI
  async (req): Promise<ResourceContent[]> => {
    // URI in req is already expanded (e.g., "file:///src/main.ts")
    console.error(`[Server] Reading template resource: ${req.uri}`);
    // IMPORTANT: Extract variable and VALIDATE the path securely!
    const requestedPath = req.uri.substring("file:///".length);
    const safePath = getSafeWorkspacePath(requestedPath); // Implement secure path logic

    try {
      const content = await fs.readFile(safePath, "utf-8");
      // Try to determine a more specific mime type if possible
      const mimeType = determineMimeType(safePath) ?? "text/plain";
      return [{ uri: req.uri, mimeType: mimeType, text: content }];
    } catch (error: any) {
      console.error(`[Server] Error reading template resource ${req.uri}: ${error.message}`);
      throw new Error(`Resource not found or access denied: ${req.uri}`);
    }
  }
);

// Placeholder for secure path validation/resolution logic
function getSafeWorkspacePath(relativePath: string): string {
  const ALLOWED_WORKSPACE = path.resolve("./workspace"); // Example base
  const absolutePath = path.resolve(ALLOWED_WORKSPACE, relativePath);
  if (!absolutePath.startsWith(ALLOWED_WORKSPACE)) {
    throw new Error("Access denied: Path outside allowed workspace.");
  }
  return absolutePath;
}
// Placeholder for mime type detection
function determineMimeType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts') return 'text/typescript';
  if (ext === '.md') return 'text/markdown';
  return undefined;
}
```

**Best Practices (Resources):**

*   **Security:** Always validate URIs and paths rigorously, especially for templates. Confine access to intended directories.
*   Return results as `ResourceContent[]`. Even if reading one URI, the server could potentially return related content (e.g., directory listing).
*   Provide accurate `mimeType`s.
*   Throw errors for access failures (leads to JSON-RPC error response).

### 3.4 Defining Prompts

Use `server.prompt()` to define prompts. Provide name, description, argument definitions, and a handler that returns the structured `PromptMessage[]`.

```typescript
import { GetPromptResult, PromptArgument } from "@modelcontextprotocol/sdk/types.js";

const promptArgs: PromptArgument[] = [
  { name: "code_snippet", description: "The code to explain", required: true },
  { name: "language", description: "The programming language", required: false },
];

server.prompt(
  "explain_code", // Prompt name (e.g., maps to /explain_code)
  "Generates a prompt asking the LLM to explain a code snippet.", // Description
  promptArgs, // Arguments definition
  // Async handler function - receives prompt arguments
  async (args): Promise<GetPromptResult> => {
    console.error(`[Server] Generating prompt 'explain_code'`);
    const code = args?.code_snippet as string ?? ''; // Access arguments
    const lang = args?.language as string ?? 'the following';

    if (!code) {
      throw new Error("Missing required argument: code_snippet");
    }

    // Construct the messages for the LLM
    return {
      // description: "Explain Code Prompt", // Optional override
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please explain ${lang} code snippet:\n\n\`\`\`\n${code}\n\`\`\``,
          },
        },
        {
          role: "assistant", // Optional: Pre-fill assistant start
          content: { type: "text", text: "Certainly! Here's an explanation of the code:" },
        }
      ],
    };
  }
);
```

**Best Practices (Prompts):**

*   Clearly define required arguments.
*   Handlers can fetch data (e.g., read resources) to embed context directly into the returned messages.
*   Structure messages logically for the LLM task.

### 3.5 Connecting Transport & Running

For local servers launched by a Host, `StdioServerTransport` is common.

```typescript
// At the end of your server setup
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr because stdout is used for MCP messages
  console.error(`[Server] ${server.info.name} v${server.info.version} running via stdio...`);

  // Keep the process alive
  await new Promise(() => {});
}

startServer().catch(e => {
  console.error("[Server] Fatal error:", e);
  process.exit(1);
});
```

Build your server (`tsc`) and run the compiled JavaScript (`node build/index.js`).

## 4. Client/Host SDK Usage

The Host application uses the `Client` class to connect to and interact with *one* server.

### 4.1 Client Initialization & Connection

The Host creates a `Client` instance and a `Transport`. For stdio, `StdioClientTransport` launches the server process.

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

// Path to the *compiled* server JS file
const serverScriptPath = path.resolve("./build/server.js"); // Adjust path

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

try {
  client = new Client(
    { name: "my-host-app", version: "0.1.0" },
    { capabilities: { /* Declare client caps like roots/sampling if needed */ } }
  );

  transport = new StdioClientTransport({
    command: process.execPath, // Path to node executable
    args: [serverScriptPath],
    // env: { API_KEY: '...' } // Optional env vars for server process
  });

  console.log("[Host] Connecting client...");
  await client.connect(transport);
  console.log("[Host] Client connected!");
  // Access server info: client.serverInfo
  // Access negotiated capabilities: client.serverCapabilities
} catch (error: any) {
  console.error("[Host] Connection failed:", error.message);
  // Handle connection error (e.g., server script not found, handshake failure)
}
```

### 4.2 Discovering Capabilities

Once connected, the Host can query the server's capabilities.

```typescript
async function discoverCapabilities(client: Client) {
  try {
    if (client.serverCapabilities?.tools) {
      const { tools } = await client.listTools();
      console.log("[Host] Discovered Tools:", tools.map(t => t.name));
      // Store/aggregate these tools for the LLM
    }
    if (client.serverCapabilities?.resources) {
      const { resources } = await client.listResources();
      console.log("[Host] Discovered Resources:", resources.map(r => r.uri));
      // Make these available to user/LLM context logic
    }
    if (client.serverCapabilities?.prompts) {
      const { prompts } = await client.listPrompts();
      console.log("[Host] Discovered Prompts:", prompts.map(p => p.name));
      // Expose these as UI commands
    }
  } catch (error: any) {
    console.error("[Host] Failed to discover capabilities:", error.message);
  }
}

if (client?.isConnected) {
  await discoverCapabilities(client);
}
```

### 4.3 Invoking Capabilities

*   **Reading Resources:** Host decides which resource to read.

    ```typescript
    async function readMyResource(client: Client, uri: string) {
      if (!client.serverCapabilities?.resources) return;
      try {
        const result = await client.readResource({ uri });
        console.log(`[Host] Read resource ${uri}:`, result.contents[0]?.text ?? '[Non-text]');
        // Use result.contents
      } catch (error: any) {
        console.error(`[Host] Failed to read resource ${uri}:`, error.message);
      }
    }
    ```

*   **Calling Tools:** LLM requests, Host **MUST** get user approval first.

    ```typescript
    import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

    async function executeTool(client: Client, name: string, args: any) {
      if (!client.serverCapabilities?.tools) return;

      // ***** MANDATORY HUMAN-IN-THE-LOOP (HITL) *****
      const userApproved = await showConfirmationDialog(name, args); // Implement this UI
      if (!userApproved) {
        console.log("[Host] User denied tool execution.");
        // Return a synthetic error result to LLM if needed
        return { isError: true, content: [{ type: 'text', text: 'User denied execution.' }]};
      }
      // ************************************************

      try {
        console.log(`[Host] Executing tool ${name}...`);
        const result: CallToolResult = await client.callTool({ name, arguments: args });
        if (result.isError) {
          console.error(`[Host] Tool ${name} execution failed:`, result.content[0]?.text);
        } else {
          console.log(`[Host] Tool ${name} executed successfully:`, result.content[0]?.text);
        }
        return result; // Return result to feed back to LLM
      } catch (error: any) {
        // Protocol error during the call
        console.error(`[Host] Protocol error calling tool ${name}:`, error.message);
        return { isError: true, content: [{ type: 'text', text: `Protocol error: ${error.message}` }]};
      }
    }

    // Placeholder for actual UI confirmation
    async function showConfirmationDialog(name: string, args: any): Promise<boolean> {
      console.warn(`[Host] --- APPROVAL NEEDED ---`);
      console.warn(`[Host] Tool: ${name}`);
      console.warn(`[Host] Args: ${JSON.stringify(args)}`);
      // Simulate asking user - REPLACE WITH REAL UI
      return true; // Assume yes for demo
    }
    ```

*   **Getting Prompts:** User triggers, Host fetches messages for LLM.

    ```typescript
    async function activatePrompt(client: Client, name: string, args?: Record<string, unknown>) {
      if (!client.serverCapabilities?.prompts) return;
      try {
        const result = await client.getPrompt({ name, arguments: args });
        console.log(`[Host] Got prompt ${name}. Messages to send to LLM:`, result.messages);
        // Initiate LLM call with result.messages
      } catch (error: any) {
        console.error(`[Host] Failed to get prompt ${name}:`, error.message);
      }
    }
    ```

### 4.4 Handling Notifications

Listen for notifications (like resource updates or list changes) if the server supports them.

```typescript
client?.onNotification("notifications/resources/updated", (params) => {
  console.log(`[Host] Resource updated: ${params.uri}. Re-fetching...`);
  // Trigger logic to re-read the resource
  readMyResource(client!, params.uri);
});

client?.onNotification("notifications/tools/list_changed", () => {
  console.log("[Host] Tool list changed. Re-discovering...");
  // Trigger logic to re-list tools
  discoverCapabilities(client!);
});
```

### 4.5 Closing the Connection

Crucial for cleanup, especially with `StdioClientTransport`.

```typescript
async function shutdown(client: Client | null) {
  if (client?.isConnected) {
    console.log("[Host] Closing client connection...");
    await client.close();
    console.log("[Host] Client connection closed.");
  }
  // transport?.process?.kill(); // Ensure process is killed if client.close() fails
}
```

## 5. Error Handling Summary

*   **Connection/Protocol Errors:** Use `try/catch` around `client.connect()`, `client.callTool()`, `client.readResource()`, etc. These usually indicate issues with the connection, handshake, or malformed messages. The SDK throws `Error` objects.
*   **Tool Execution Errors:** Check the `isError: true` flag within the `CallToolResult` returned by a *successful* `client.callTool()` call. This indicates the tool itself failed its task (e.g., API error, file not found by the tool).
*   **Server Logging:** Use `console.error` in stdio servers. For other transports or client-visible logs, use the `logging` capability and `server.sendLoggingMessage()`. Hosts can listen for `notifications/message`.

## 6. Advanced Topics (Brief Mention)

*   **Logging:** Servers declare `logging` capability. Clients use `client.setLoggingLevel()`. Servers send `notifications/message`. Clients listen via `client.onNotification()`.
*   **Sampling:** Clients declare `sampling` capability. Servers use `client.createMessage()` (if available via the `exchange` object passed to server handlers). Hosts **must** implement HITL for these requests.
*   **Roots:** Clients declare `roots` capability. Servers use `client.listRoots()`. Clients send `notifications/roots/list_changed`.
*   **Completions:** Servers declare `completions` capability. Clients use `client.complete()` for argument suggestions.
*   **Pagination:** List methods return `nextCursor`. Pass this in subsequent request `params.cursor` to get the next page.

## 7. Where to Go Next

*   **Conceptual Guide:** For the "why" and intended roles of primitives.
*   **Comprehensive Guide:** For exhaustive details on all SDK features and types.
*   **MCP Specification:** The ultimate source of truth for protocol messages and behavior.
*   **SDK Repository:** For source code, specific API docs, and examples.

--- END OF FILE mcp-typescript-sdk-usage.md ---