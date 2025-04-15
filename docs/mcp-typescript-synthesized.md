Okay, here is the full, updated `mcp-typescript-synthesized.md` document incorporating the previously discussed refinements.

--- START OF FILE mcp-typescript-synthesized.md ---

# Model Context Protocol (MCP) TypeScript SDK - Comprehensive Guide

This document provides a comprehensive guide to the Model Context Protocol (MCP) and the official TypeScript SDK. It's designed to give an LLM or a developer the necessary context to understand MCP principles and build both MCP Servers and the Host applications that consume them using TypeScript.

## 1. What is MCP?

The Model Context Protocol (MCP) is an open standard designed to standardize how AI applications (like LLMs, agents, and chatbots) interact with external context sources and tools. It acts as a standardized "plug" or interface, allowing AI models running within a "Host" application to securely access and utilize data and functionalities provided by separate "Server" processes.

**Why MCP?**

-   **Interoperability:** Any MCP-compliant host can potentially connect to any MCP-compliant server. Build a server once, use it in multiple AI applications.
-   **Composability:** Hosts can connect to multiple specialized servers simultaneously (e.g., one for files, one for git, one for a specific API), combining their capabilities.
-   **Security:** Defines clear boundaries and control flows. The Host (and user) remains in control, especially regarding data access and tool execution, preventing servers from accessing sensitive chat history or executing actions without explicit permission.
-   **Extensibility:** Easily add new capabilities to AI applications by building new, focused servers without modifying the core Host application logic extensively.
-   **Decoupling:** Separates the AI/LLM logic (in the Host) from the tool/data integration logic (in the Servers).

## 2. Core Concepts: Host, Client, Server

MCP operates on a client-host-server architecture:

1.  **Host:**
    -   The main application where the AI/LLM runs (e.g., an IDE extension like Continue.dev, Claude Desktop, a custom agent framework).
    -   **Responsibilities:**
        -   Discovers, configures, and launches MCP Servers (often via configuration).
        -   Manages MCP `Client` instances (one per connected server).
        -   Aggregates capabilities (especially Tools) from multiple connected clients for the LLM.
        -   Orchestrates the interaction flow between the user, the LLM, and the MCP Clients/Servers.
        -   Enforces security policies, most importantly obtaining **user consent** for tool execution and potentially for resource access or server connections.
        -   Presents information (server status, available prompts, resource lists, tool confirmation dialogs) to the user.
2.  **Client (MCP SDK `Client` class):**
    -   An instance _within_ the Host application, managed by the Host.
    -   Maintains a 1:1 stateful connection with a single MCP Server instance.
    -   Handles MCP protocol communication (requests, responses, notifications) over a specific transport layer (`StdioClientTransport`, or a custom HTTP implementation).
    -   Exposes the connected server's capabilities (Tools, Resources, Prompts) to the Host via SDK methods (`listTools`, `readResource`, `callTool`, etc.).
3.  **Server (MCP SDK `McpServer` class):**
    -   A separate process or service (can be local or remote). Launched by the Host (stdio) or running independently (HTTP).
    -   Provides specific capabilities (Tools, Resources, Prompts) through MCP primitives.
    -   Communicates _only_ with its connected Client over the agreed transport.
    -   Has no direct knowledge of the Host, the LLM, the user, or other Servers.

**Architecture Diagram:**

```mermaid
graph LR
    subgraph "Host Application (e.g., IDE, Claude Desktop)"
        H[Host<br>Manages Clients, Coordinates LLM, Enforces Security]
        C1[MCP Client 1<br>(SDK Instance)]
        C2[MCP Client 2<br>(SDK Instance)]
        H -- Creates/Manages --> C1
        H -- Creates/Manages --> C2
    end

    subgraph "Server Process A (e.g., Filesystem Server)"
        S1[MCP Server A<br>(SDK Instance)<br>Exposes File Tools/Resources]
        D1[("Local Files")]
        S1 <--> D1
    end

    subgraph "Server Process B (e.g., API Wrapper Server)"
        S2[MCP Server B<br>(SDK Instance)<br>Exposes API Tools]
        D2[("External API")]
        S2 <--> D2
    end

    C1 -- MCP Protocol<br>(Stdio / Streamable HTTP) --> S1
    C2 -- MCP Protocol<br>(Stdio / Streamable HTTP) --> S2

    style H fill:#lightblue,stroke:#333,stroke-width:2px
    style S1 fill:#lightgreen,stroke:#333,stroke-width:2px
    style S2 fill:#lightgreen,stroke:#333,stroke-width:2px
```

## 3. Key MCP Primitives (Server Capabilities)

Servers expose their functionality through three main primitives, each with a distinct control model:

-   **Resources (`resources` capability):**
    -   **What:** Represents data sources that can be read by the client/host (e.g., file content, database schemas, API GET responses, git history, log entries). Identified by unique URIs (e.g., `file:///path/to/file`, `git:///repo?ref=main&path=src/index.js`, `db:///schema/users`). Can be static listings or defined via URI Templates (e.g., `file:///{path}`).
    -   **Control:** **Application-controlled**. The Host application decides _if_, _when_, and _how_ to fetch (`readResource`) and use resource data. It might present resources to the user for selection, automatically include relevant ones based on context, or allow the LLM to request specific resources (which the Host then fetches).
    -   **SDK Methods (Client):** `listResources()`, `readResource()`, `listResourceTemplates()`, `subscribeToResource()`, `unsubscribeFromResource()`.
    -   **SDK Methods (Server):** `server.resource()` (for static), `server.resourceTemplate()`, handlers for reading/subscribing.
    -   **Optional Features:** `listChanged` (server notifies client of changes to the list), `subscribe` (client can subscribe to notifications for individual resource content changes).
-   **Tools (`tools` capability):**
    -   **What:** Executable functions that allow the LLM (via the Host) to perform actions or computations (e.g., write file, run code, call an API POST endpoint, search database, execute shell command). Defined with names, descriptions, and JSON Schema for inputs. Can have annotations (e.g., `readOnly`, `destructive`).
    -   **Control:** **Model-controlled (with MANDATORY User Approval)**. The LLM typically decides _which_ tool to use and _what_ arguments to provide based on the user's request and context. However, the Host **MUST** intercept this request, present it clearly to the user (tool name, arguments, description, potential impact based on annotations), and **obtain explicit user consent** before executing the `callTool` method via the Client.
    -   **SDK Methods (Client):** `listTools()`, `callTool()`.
    -   **SDK Methods (Server):** `server.tool()`, tool execution handler.
    -   **Optional Features:** `listChanged` (server notifies client of changes to the tool list).
-   **Prompts (`prompts` capability):**
    -   **What:** Pre-defined message templates or workflows, often with arguments, designed to guide user interaction or LLM tasks (e.g., `/summarize <resource_uri>`, `/generateCommitMessage`, `/explainCode`).
    -   **Control:** **User-controlled**. The Host discovers available prompts (`listPrompts`) and exposes them to the user (e.g., as slash commands, menu items, buttons). The _user_ explicitly chooses to invoke a prompt, potentially providing arguments. The Host then calls `getPrompt` to retrieve the structured messages from the server and typically sends these messages to the LLM.
    -   **SDK Methods (Client):** `listPrompts()`, `getPrompt()`.
    -   **SDK Methods (Server):** `server.prompt()`, prompt handler.
    -   **Optional Features:** `listChanged` (server notifies client of changes to the prompt list).

## 4. Client Capabilities

Clients (representing the Host) can also declare capabilities to the Server during initialization:

-   **Roots (`roots` capability):**
    -   **What:** Allows the client/host to inform the server about relevant base URIs (primarily `file://` URIs) that define the user's workspace or context. Servers can then use `roots/list` to discover these boundaries.
    -   **Control:** Host/User controlled. The Host determines which roots are relevant (e.g., open project folders).
    -   **Optional Features:** `listChanged` (client notifies server if roots change).
-   **Sampling (`sampling` capability):**
    -   **What:** Allows a _server_ to request that the _client/host_ perform an LLM generation (`sampling/createMessage`). This enables agentic behaviors where a server might need LLM processing as part of its own logic (e.g., a code analysis tool asking an LLM to summarize findings).
    -   **Control:** Server-initiated, but **Host/User controlled**. The Host receives the request, **MUST** get user approval (potentially allowing prompt modification), performs the LLM call using its own models/APIs, gets user approval for the response, and then sends the result back to the server.
    -   **Security:** This flow prevents servers from needing their own LLM API keys and keeps the Host/User in control of all LLM interactions.

## 5. Getting Started (TypeScript SDK)

Install the core SDK and `zod` (highly recommended for robust schema validation):

```bash
npm install @modelcontextprotocol/sdk zod
# or
yarn add @modelcontextprotocol/sdk zod
# or
pnpm add @modelcontextprotocol/sdk zod
```

## 6. Building MCP Servers with TypeScript

A server exposes one or more MCP primitives.

```typescript
// src/my-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises"; // Example: Using Node's filesystem
import path from "path"; // For secure path handling

// Define allowed base path for security
const ALLOWED_BASE_PATH = path.resolve("./mcp_server_data"); // Example base directory

// Helper to ensure path stays within the allowed directory
function getSafePath(relativePath: string): string {
  const absolutePath = path.resolve(ALLOWED_BASE_PATH, relativePath);
  if (!absolutePath.startsWith(ALLOWED_BASE_PATH)) {
    throw new Error("Access denied: Path is outside the allowed directory.");
  }
  return absolutePath;
}

async function main() {
  // Ensure base directory exists
  await fs.mkdir(ALLOWED_BASE_PATH, { recursive: true });
  // Create initial notes file if it doesn't exist
  const notesFilePath = getSafePath("important-notes.txt");
  try {
    await fs.access(notesFilePath);
  } catch {
    await fs.writeFile(notesFilePath, "Initial project notes.\n", "utf-8");
  }

  const server = new McpServer({
    // Server Identification
    name: "my-multi-server",
    version: "1.0.0",
    // Declare ALL capabilities this server offers
    capabilities: {
      resources: { listChanged: false, subscribe: false }, // Exposes resources
      tools: { listChanged: false }, // Exposes tools
      prompts: { listChanged: false }, // Exposes prompts
      // logging: {}, // Uncomment if providing logs via notifications/message
      // completions: {}, // Uncomment if providing argument completions
    },
  });

  // --- Define a Resource ---
  const resourceUri = "file:///important-notes.txt"; // Relative to server's context
  server.resource(
    {
      uri: resourceUri,
      name: "Important Notes",
      description: "Crucial project notes stored in important-notes.txt.",
      mimeType: "text/plain",
      // size: (await fs.stat(notesFilePath)).size, // Optionally provide size
    },
    // Read Handler: Called when client requests `readResource`
    async (req) => {
      try {
        const safePath = getSafePath("important-notes.txt"); // Use relative path from URI
        const content = await fs.readFile(safePath, "utf-8");
        return [
          // Result MUST be an array of ResourceContent
          {
            uri: resourceUri, // Use the canonical URI
            mimeType: "text/plain",
            text: content,
          },
        ];
      } catch (error: any) {
        console.error(
          `[Server] Failed to read resource ${resourceUri}:`,
          error
        );
        // Throwing here generates a JSON-RPC error response
        throw new Error(`Resource not found or unreadable: ${resourceUri}`);
      }
    }
  );

  // --- Define a Tool ---
  const appendToolSchema = z.object({
    text_to_append: z.string().min(1).describe("The text to add to the notes."),
  });
  server.tool(
    "append_to_notes", // Tool name
    "Appends text to the 'important-notes.txt' file.", // Description for LLM/User
    appendToolSchema, // Input schema using Zod
    // Tool Execution Handler: Called when client requests `callTool`
    async (args) => {
      // args are validated against the schema
      try {
        const safePath = getSafePath("important-notes.txt");
        // Perform the action
        await fs.appendFile(safePath, `\n${args.text_to_append}`, "utf-8");
        // Return a success result
        return {
          isError: false, // Indicate success
          content: [{ type: "text", text: "Successfully appended to notes." }],
        };
      } catch (error: any) {
        console.error(
          "[Server] Failed to execute tool 'append_to_notes':",
          error
        );
        // Return a tool execution error (not a protocol error)
        return {
          isError: true, // Indicate failure
          content: [
            { type: "text", text: `Failed to append: ${error.message}` },
          ],
        };
      }
    },
    // Optional: Annotations describing the tool's nature
    { readOnly: false, destructive: false }
  );

  // --- Define a Prompt ---
  server.prompt(
    "summarize_notes", // Prompt name (e.g., for slash command)
    "Creates a prompt asking the LLM to summarize the important notes.", // Description
    [], // No arguments needed for this prompt
    // Prompt Handler: Called when client requests `getPrompt`
    async (args) => {
      try {
        // Fetch the resource content dynamically to include it
        const safePath = getSafePath("important-notes.txt");
        const noteContent = await fs.readFile(safePath, "utf-8");
        // Construct the messages for the LLM
        return {
          // description: "Summary prompt for notes", // Optional override description
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Please summarize the following notes for me:",
              },
            },
            {
              // Embed the resource content directly in the prompt
              role: "user",
              content: {
                type: "resource",
                resource: {
                  uri: resourceUri, // Use the canonical URI
                  mimeType: "text/plain",
                  text: noteContent, // Include the fetched content
                },
              },
            },
          ],
        };
      } catch (error: any) {
        console.error(
          "[Server] Failed to get prompt 'summarize_notes':",
          error
        );
        throw new Error("Could not construct prompt - notes unreadable.");
      }
    }
  );

  // --- Connect Transport ---
  // Stdio is common for local servers launched by a host
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log server status to stderr, as stdout is used for MCP messages
  console.error("[Server] MCP Server running via stdio...");

  // Keep the server process alive indefinitely
  await new Promise(() => {});
}

// Graceful shutdown handling (optional but recommended)
process.on("SIGINT", () => {
  console.error("[Server] Received SIGINT, shutting down.");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.error("[Server] Received SIGTERM, shutting down.");
  process.exit(0);
});

main().catch((error) => {
  console.error("[Server] Fatal error:", error);
  process.exit(1);
});
```

**Key Server Development Points:**

-   **Initialization:** Use `new McpServer(...)` specifying `name`, `version`, and all `capabilities` it provides.
-   **Capabilities:** Define resources (`server.resource`, `server.resourceTemplate`), tools (`server.tool`), and prompts (`server.prompt`) with their respective handlers.
-   **Schema Validation:** Use `zod` for defining and validating tool input schemas. The handler receives already validated arguments.
-   **Handlers:** Implement the logic for reading resources, executing tools, or generating prompt messages.
    -   Resource handlers return `Promise<ResourceContent[]>`.
    -   Tool handlers return `Promise<CallToolResult>`. Indicate tool execution errors with `isError: true`.
    -   Prompt handlers return `Promise<GetPromptResult>`.
-   **Error Handling:**
    -   Throwing an `Error` inside a handler generally results in a JSON-RPC error response sent to the client (e.g., for unreadable resources or unconstructable prompts).
    -   Tool execution failures specific to the tool's logic should be returned within the `CallToolResult` using `isError: true`.
-   **Security:** **Critically important.** Sanitize inputs, validate paths (as shown with `getSafePath`), check permissions, and avoid exposing sensitive information. Never trust client-provided paths or arguments directly without validation relevant to the server's context.
-   **Logging:** Use `console.error()` when using `StdioServerTransport`, as `console.log()` (stdout) is reserved for MCP messages. For HTTP transports or sending logs to the client, use the `logging` capability and `server.sendLoggingMessage()`.
-   **Transport:** Connect a transport (`StdioServerTransport` for local, or implement HTTP handling for network).
-   **Lifecycle:** Ensure the server process stays alive and handles shutdown signals gracefully.

## 7. Building MCP Client Interactions (Host Perspective)

The Host application uses the `Client` class to discover and interact with _one specific_ connected server. Building a full Host involves managing multiple clients, coordinating with an LLM, and handling UI/user interaction. This example shows the basic interaction patterns with a single client instance.

```typescript
// src/host-example.ts (Illustrative - showing interaction patterns)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js"; // Import specific types
import path from "path";
import { fileURLToPath } from "url";

// --- Host Setup (Simplified - assumes server is built) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Path to the *compiled* server script (e.g., from `npm run build` for the server)
const serverScriptPath = path.resolve(__dirname, "../build/my-server.js"); // Adjust as needed

// --- Mock User Interaction ---
async function askUserConfirmation(
  toolName: string,
  args: any
): Promise<boolean> {
  console.log(`\n--- HOST: USER CONFIRMATION NEEDED ---`);
  console.log(`AI wants to run tool: ${toolName}`);
  console.log(`With arguments: ${JSON.stringify(args)}`);
  // In a real app, use a GUI dialog (Electron, web modal, etc.)
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) =>
    readline.question("Allow execution? (yes/no): ", resolve)
  );
  readline.close();
  return answer.toLowerCase() === "yes";
}

// --- Main Host Interaction Logic ---
async function interactWithServer() {
  let mcpClient: Client | null = null;
  let transport: StdioClientTransport | null = null;

  try {
    // --- Host Instantiates a Client ---
    // Client info helps server identify the host
    mcpClient = new Client(
      { name: "my-host-app", version: "0.1.0" },
      // Optionally declare client capabilities (e.g., if supporting roots/sampling)
      {
        capabilities: {
          /* roots: {}, sampling: {} */
        },
      }
    );

    // --- Host Creates Transport to Start/Connect Server ---
    // StdioClientTransport launches the server process
    transport = new StdioClientTransport({
      command: process.execPath, // 'node' executable path
      args: [serverScriptPath], // Arguments to pass to the server script
      // env: { ... } // Optional environment variables for the server
    });

    // --- Host Connects Client (Initiates MCP Handshake) ---
    console.log("Host: Connecting to server via stdio...");
    await mcpClient.connect(transport);
    console.log("Host: Connected successfully.");
    // Server capabilities are now available via mcpClient.serverCapabilities

    // --- Host Discovers Server Capabilities ---
    console.log("\nHost: Listing available tools...");
    const toolsList = await mcpClient.listTools(); // Fetches tools from the server
    console.log(
      "Host: Found tools:",
      toolsList.tools.map((t) => t.name)
    );
    // Host would typically format this list for the LLM

    console.log("\nHost: Listing available resources...");
    const resourceList = await mcpClient.listResources(); // Fetches resources
    console.log(
      "Host: Found resources:",
      resourceList.resources.map((r) => r.name)
    );
    // Host might display these to the user or use them for context

    console.log("\nHost: Listing available prompts...");
    const promptList = await mcpClient.listPrompts(); // Fetches prompts
    console.log(
      "Host: Found prompts:",
      promptList.prompts.map((p) => p.name)
    );
    // Host might expose these as slash commands

    // --- Host Uses Capabilities (Simulating LLM/User Actions) ---

    // Example 1: Reading a resource (Application-controlled)
    console.log("\nHost: Reading 'Important Notes' resource...");
    const resourceUriToRead = "file:///important-notes.txt"; // Host determines which resource to read
    const readResult = await mcpClient.readResource({ uri: resourceUriToRead });
    const firstContent = readResult.contents[0];
    if (firstContent?.type === "text") {
      console.log(
        `Host: Resource content received:\n---\n${firstContent.text}\n---`
      );
      // Host might pass this content to the LLM as context
    } else {
      console.error(
        "Host: Failed to read resource or unexpected content type."
      );
    }

    // Example 2: Calling a tool (Model-controlled + User Approval)
    const toolNameToCall = "append_to_notes";
    const toolArguments = {
      text_to_append: `Host log: ${new Date().toISOString()}`,
    };
    console.log(
      `\nHost: Simulating LLM wanting to call tool '${toolNameToCall}'...`
    );

    // ***** CRITICAL: HUMAN-IN-THE-LOOP *****
    const userApproved = await askUserConfirmation(
      toolNameToCall,
      toolArguments
    );

    let toolCallResult: CallToolResult;
    if (userApproved && mcpClient) {
      // Check client still exists
      console.log(
        "Host: User approved. Executing tool via client.callTool()..."
      );
      // Use try/catch for potential protocol errors during the call
      try {
        toolCallResult = await mcpClient.callTool({
          name: toolNameToCall,
          arguments: toolArguments,
        });
        // Check for tool execution errors reported by the server
        if (toolCallResult.isError) {
          console.error(
            "Host: Tool call failed (server reported error):",
            toolCallResult.content[0]?.text ?? "Unknown error"
          );
        } else {
          console.log(
            "Host: Tool call successful:",
            toolCallResult.content[0]?.text ?? "No text result"
          );
        }
      } catch (protocolError: any) {
        console.error("Host: Protocol error during tool call:", protocolError.message);
        toolCallResult = {
          isError: true,
          content: [{ type: "text", text: `Protocol error: ${protocolError.message}` }]
        };
      }
    } else {
      console.log("Host: User denied tool execution or client not available.");
      // Create a synthetic error result to send back to the LLM
      toolCallResult = {
        isError: true,
        content: [{ type: "text", text: "Tool execution denied by user." }],
      };
    }
    // Host would typically format toolCallResult and send it back to the LLM

    // Example 3: Getting a prompt (User-controlled)
    const promptNameToGet = "summarize_notes";
    console.log(
      `\nHost: Simulating user invoking prompt '${promptNameToGet}'...`
    );
    const promptResult = await mcpClient.getPrompt({ name: promptNameToGet });
    console.log(
      "Host: Received prompt messages. Would format and send these to LLM:",
      JSON.stringify(promptResult.messages, null, 2)
    );
    // Host takes promptResult.messages and initiates an LLM call with them
  } catch (error: any) {
    console.error("Host: An error occurred during interaction:", error.message);
    if (error.cause) {
      console.error("Host: Cause:", error.cause);
    }
  } finally {
    // --- Host Closes Connection ---
    if (mcpClient) {
      console.log("\nHost: Closing connection...");
      await mcpClient.close(); // Gracefully shuts down client and transport
      console.log("Host: Connection closed.");
    }
    // Ensure transport process is terminated if stdio
    if (transport?.process) {
      if (!transport.process.killed) {
        console.log("Host: Ensuring server process is terminated.");
        transport.process.kill();
      }
    }
  }
}

interactWithServer();
```

**Key Client/Host Interaction Points:**

-   **Instantiation:** Host creates `Client` instance, potentially declaring client capabilities.
-   **Transport:** Host creates the `Transport` (e.g., `StdioClientTransport` which _starts_ the server process, or an HTTP transport).
-   **Connection:** Host calls `client.connect(transport)` to perform the MCP handshake.
-   **Discovery:** Host uses `listTools()`, `listResources()`, `listPrompts()` to learn server capabilities.
-   **Interaction:** Host uses `readResource()`, `callTool()`, `getPrompt()` to interact based on user/LLM actions.
-   **Human-in-the-Loop (HITL):** The Host **MUST** implement user confirmation before executing `callTool()`. This is a core security requirement.
-   **Error Handling:** The Host needs to handle errors from client methods (e.g., connection failures, protocol errors, typically via `try/catch`) and also check the `isError` flag in `CallToolResult` for tool-specific execution failures.
-   **Lifecycle:** The Host is responsible for managing the client/server lifecycle, including calling `client.close()` when finished, which should terminate stdio transports.

## 8. Building Robust MCP Hosts (Conceptual Patterns)

Building a full Host application involves more than just single client interactions. Key considerations include:

1.  **Server Discovery & Configuration:**
    -   **Problem:** How does the Host know which servers exist and how to run/connect to them?
    -   **Pattern:** Use a configuration file (e.g., JSON, YAML) that defines servers, their launch commands (for stdio), connection details (for HTTP), required environment variables, and enablement status. Claude Desktop uses `claude_desktop_config.json`.
    -   **Example (`host-config.json`):**
        ```json
        {
          "mcpServers": {
            "filesystem": {
              "command": "npx",
              "args": [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "/Users/me/safe-dir"
              ],
              "enabled": true
            },
            "my-custom-server": {
              "command": "node",
              "args": ["/path/to/my/server/build/index.js"],
              "enabled": true,
              "env": { "API_KEY": "secret_value" }
            },
            "remote-http-server": {
              "transport": "http", // Indicate non-stdio
              "url": "https://api.example.com/mcp",
              "enabled": true
              // Auth details might be stored securely elsewhere or handled via OAuth flow
            }
          }
        }
        ```

2.  **Client Lifecycle Management:**
    -   **Problem:** Starting, stopping, monitoring, and restarting connections/server processes.
    -   **Pattern:** Maintain a collection (e.g., `Map<string, { client: Client; transport: Transport; config: ServerConfig }>`) of active clients. On startup, read the config and launch/connect enabled servers. Implement error handling for connection failures. Provide logic to restart failed servers (with backoff). Ensure `client.close()` is called on Host shutdown to terminate connections and stdio processes. Listen for transport `onclose` events.

3.  **Aggregating Capabilities (especially Tools):**
    -   **Problem:** The LLM needs a single, coherent list of all available tools from _all_ connected servers.
    -   **Pattern:** Periodically, or when notified (`notifications/tools/list_changed`), iterate through all active clients. Call `listTools()` on each. Combine the results into a single list. **Crucially:** Prefix tool names with a unique client identifier (e.g., `filesystem__readFile`, `customApi__getUserData`) to avoid collisions and allow the Host to dispatch calls to the correct client later. Store the original client ID and tool name alongside the formatted definition for the LLM.

4.  **LLM Interaction Loop & Tool Dispatch:**
    -   **Problem:** Managing the flow: User Input -> Context -> LLM -> [Tool Call -> User Approval -> Execute -> Result -> LLM] -> Final Response.
    -   **Pattern:**
        1.  Gather user input and chat history.
        2.  Fetch relevant `Resources` (optional, based on Host logic).
        3.  Aggregate available `Tools` (as described above).
        4.  Format prompt for LLM (input, history, resources, tool definitions).
        5.  Call LLM API.
        6.  Parse LLM response. If it contains a tool call request:
            a. Extract the _prefixed_ tool name (e.g., `filesystem__readFile`) and arguments.
            b. Parse the prefix to identify the target `clientId` (`filesystem`) and the original `toolName` (`readFile`).
            c. Retrieve the corresponding `Client` instance.
            d. **Initiate HITL user confirmation flow.**
            e. If approved, call `client.callTool({ name: originalToolName, arguments: ... })`.
            f. Format the `CallToolResult` (success or error) and feed it back to the LLM (return to step 5).
        7.  If the LLM response is final text, display it to the user.

5.  **Implementing Human-in-the-Loop (HITL) Robustly:**
    -   **Problem:** Ensuring users understand and approve tool actions before execution.
    -   **Pattern:** Design a clear, unavoidable confirmation UI (modal dialog, dedicated prompt area). Display:
        -   The server requesting the action (e.g., "Filesystem Server").
        -   The specific tool name (e.g., `writeFile`).
        -   A clear description of the tool (from `listTools`).
        -   Any relevant annotations (`destructive`, `readOnly`).
        -   The _exact_ arguments provided by the LLM.
        -   Clear "Allow" / "Deny" actions.
        -   Log the decision. Only proceed with `callTool` upon explicit user approval.

## 9. Transports

MCP defines the message format (JSON-RPC) but allows different transport mechanisms. The TypeScript SDK provides built-in support for stdio and components for building others.

-   **Stdio (`StdioServerTransport`, `StdioClientTransport`):**
    -   **How:** Client (Host) launches the Server as a subprocess. Communication happens over the server's standard input (`stdin`) and standard output (`stdout`). `stderr` can be used for logging. Messages are newline-delimited JSON-RPC.
    -   **Use Case:** Excellent for local development, integrating local command-line tools, or when the Host should manage the Server's lifecycle directly. Simple setup.
    -   **SDK Role:** Provides classes to manage the subprocess and handle message framing.

-   **Streamable HTTP (New in Spec 2025-03-26):**
    -   **How:** Server runs independently and exposes a single HTTP endpoint supporting POST (for client messages) and optionally GET (for server-initiated messages via SSE). Server can respond to POSTs with a single JSON response or stream multiple messages (responses, requests, notifications) using Server-Sent Events (`text/event-stream`). Supports sessions via `Mcp-Session-Id` header.
    -   **Use Case:** Networked communication, remote servers, independently running servers, scenarios needing server-to-client pushes (resource updates, server-initiated requests like sampling). More complex infrastructure.
    -   **SDK Role:** The core SDK provides the `Client` and `McpServer` _protocol logic_. It **does not** include a built-in HTTP server/client implementation. The developer **must** build the HTTP layer (using libraries like `express`, `fastify`, Node's `http`, or `fetch`) and integrate the SDK's message handling (`server.handleMessage`, `client.handleMessage`) and session management logic according to the specification.

## 10. Security & Trust

**This is paramount.** MCP interactions can involve file access, API calls, and code execution.

-   **User Consent is KING:**
    -   **Connections:** Users must consent before a Host connects to _any_ server, especially remote or untrusted ones.
    -   **Tool Execution:** **Mandatory HITL.** Users _must_ explicitly approve _every_ tool call before `client.callTool` is invoked by the Host. The confirmation UI must be clear about the action, arguments, and source server.
    -   **Resource Access:** Depending on sensitivity, Hosts might require user confirmation before reading/using certain resources.
-   **Data Privacy:** Servers only see what the Client/Host explicitly sends (tool args, resource read requests). They don't see chat history or other servers' data unless the Host includes it in a `sampling` request (which _also_ requires HITL).
-   **Server Trust:** Hosts should treat servers as potentially untrusted, especially community or remote ones. Validate responses. Be cautious with capabilities declared. Don't implicitly trust tool descriptions or annotations; use them to inform the user during HITL.
-   **Input Sanitization:** Servers **must** sanitize arguments received in `callTool` or `getPrompt`. Hosts **should** sanitize data received from servers before displaying or using it.
-   **Secure Transport:** Use HTTPS for Streamable HTTP transport.
-   **Authorization:** For HTTP transports, MCP defines an optional OAuth 2.1-based [Authorization framework](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization). Hosts and Servers supporting auth **MUST** implement this securely, including PKCE, token storage, and potentially Dynamic Client Registration. Clients send tokens via the `Authorization: Bearer <token>` header. Stdio servers should rely on environment variables or other OS-level mechanisms if auth is needed.

## 11. Advanced Concepts & Other Features

-   **Lifecycle:** MCP has a strict initialization handshake (`initialize` request/response, `initialized` notification) where versions and capabilities are negotiated. The SDK handles this internally during `client.connect()`.
-   **Error Handling:** Differentiate between:
    -   **Protocol Errors:** JSON-RPC errors (e.g., `MethodNotFound`, `InvalidParams`, `InternalError`) returned in the `error` field of a response. The SDK often throws exceptions for these (catch with `try/catch` around client calls).
    -   **Tool Execution Errors:** Returned within a _successful_ `CallToolResult` but with `isError: true`. The Host must check this flag after a successful `callTool` promise resolves.
-   **Authorization:** (See Security & Transport). Optional OAuth 2.1 flow for HTTP.
-   **Pagination:** List methods (`listTools`, `listResources`, etc.) support cursor-based pagination via `params.cursor` and `result.nextCursor`.
-   **Completions:** Servers can optionally provide argument completion suggestions (`completion/complete`) for Prompts and Resource Templates.
-   **Logging:** Servers can send log messages (`notifications/message`) to clients if the `logging` capability is enabled. Clients can set the desired level (`logging/setLevel`).
-   **Client Capabilities:** Hosts can declare support for `roots` and `sampling`.
-   **Batching:** MCP supports JSON-RPC batching (sending multiple requests/notifications in a single array). The SDK should handle *receiving* batches transparently. Sending batches might require specific transport-level support or manual construction.

## 12. Further Information

-   **Official Website:** [modelcontextprotocol.io](https://modelcontextprotocol.io/)
-   **Full Specification (Latest):** [modelcontextprotocol.io/specification/2025-03-26/](https://modelcontextprotocol.io/specification/2025-03-26/) (Essential for detailed message structures, error codes, and protocol nuances)
-   **TypeScript SDK Repository:** [github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) (Check for detailed API documentation, examples, and source code)
-   **Example Servers/Clients:** Explore official and community examples linked from the website/repositories for practical implementations.
-   **Debugging Guide:** [modelcontextprotocol.io/docs/tools/debugging](https://modelcontextprotocol.io/docs/tools/debugging)
-   **MCP Inspector Tool:** [github.com/modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) (Useful for testing servers interactively)

## 13. License

Apache License 2.0

--- END OF FILE mcp-typescript-synthesized.md ---