import {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  CallToolRequest,
  ReadResourceRequest,
  GetPromptRequest,
  CreateMessageRequest,
  CreateMessageResult,
  Root,
  ClientCapabilities,
  McpError,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  Progress as SDKProgress,
  Implementation,
  TextContent,
  ImageContent,
  AudioContent,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * Base configuration for a server connection.
 * Defines common properties for all server transports.
 */
interface BaseServerConfig {
  /** A unique identifier for this server within the host */
  id: string;
  /** Optional friendly name for the server */
  name?: string;
  /** Transport type to use for server connection */
  transport: "stdio" | "sse" | "websocket" | "streamable-http";
  /** Optional environment variables for stdio transport */
  env?: Record<string, string>;
  /** Optional working directory for stdio transport */
  cwd?: string;
  /** Optional configuration for the MCP Client instance for this server */
  clientOptions?: Partial<ClientOptions>;
}

/**
 * Server configuration for stdio (standard input/output) transport.
 * Used for launching server processes that communicate via stdin/stdout.
 */
export interface StdioServerConfig extends BaseServerConfig {
  /** Transport type must be "stdio" */
  transport: "stdio";
  /** The command to execute to start the server process */
  command: string;
  /** Arguments to pass to the command when starting the server */
  args?: string[];
}

/**
 * Server configuration for Server-Sent Events (SSE) transport.
 * Used for connecting to servers that expose capabilities via HTTP Server-Sent Events.
 * @deprecated Use StreamableHttpServerConfig instead for MCP 2025-03-26+.
 */
export interface SseServerConfig extends BaseServerConfig {
  /** Transport type must be "sse" */
  transport: "sse";
  /** The full URL of the SSE endpoint */
  url: string;
  /** Optional configuration specific to SSE client transport */
  options?: SSEClientTransportOptions;
}

/**
 * Server configuration for WebSocket transport.
 * Used for connecting to servers that expose capabilities via WebSocket protocol.
 */
export interface WebSocketServerConfig extends BaseServerConfig {
  /** Transport type must be "websocket" */
  transport: "websocket";
  /** The full URL of the WebSocket endpoint */
  url: string;
}

/**
 * Server configuration for Streamable HTTP transport (MCP 2025-03-26+).
 * Used for connecting to servers using the single-endpoint HTTP POST/GET model.
 */
export interface StreamableHttpServerConfig extends BaseServerConfig {
  /** Transport type must be "streamable-http" */
  transport: "streamable-http";
  /** The single base URL for the MCP endpoint (e.g., "http://localhost:3000/mcp") */
  url: string;
  /** Optional headers to include in requests (e.g., for authentication) */
  headers?: Record<string, string>;
}

/**
 * Union type representing all possible server configuration types.
 * Allows specifying different connection methods for MCP servers.
 */
export type ServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | WebSocketServerConfig
  | StreamableHttpServerConfig;

/**
 * Configuration for the entire MCP Client Host.
 * Defines the host's identity, capabilities, and server connections.
 */
export interface McpHostConfig {
  /** An array of server configurations to connect to */
  servers: ServerConfig[];
  /** Capabilities the host application supports (e.g., sampling, root management) */
  hostCapabilities?: ClientCapabilities;
  /** Information identifying the host application */
  hostInfo: Implementation;
}

/**
 * Represents a tool aggregated from a specific server.
 * Extends the base Tool interface with server identification and annotations.
 */
export interface AggregatedTool extends Tool {
  /** Identifier of the server providing this tool */
  serverId: string;
  /** Optional annotations describing tool behavior */
  annotations?: ToolAnnotations;
}

/**
 * Represents a resource aggregated from a specific server.
 * Extends the base Resource interface with server identification and size.
 */
export interface AggregatedResource extends Resource {
  /** Identifier of the server providing this resource */
  serverId: string;
  /** Optional size of the resource in bytes */
  size?: number;
}

/**
 * Represents a resource template aggregated from a specific server.
 * Extends the base ResourceTemplate interface with server identification.
 */
export interface AggregatedResourceTemplate extends ResourceTemplate {
  /** Identifier of the server providing this resource template */
  serverId: string;
}

/**
 * Represents a prompt aggregated from a specific server.
 * Extends the base Prompt interface with server identification.
 */
export interface AggregatedPrompt extends Prompt {
  /** Identifier of the server providing this prompt */
  serverId: string;
}

/**
 * Event types emitted by the McpClientHost.
 * Defines the structure and payload of various host events.
 */
export type McpHostEvents = {
  /**
   * Fired when a server successfully connects and initializes.
   * Provides the server ID and the client instance.
   */
  serverConnected: [serverId: string, client: Client];

  /**
   * Fired when a server disconnects, either cleanly or due to an error.
   * Provides the server ID and an optional error object.
   */
  serverDisconnected: [serverId: string, error?: Error];

  /**
   * Fired when an error occurs on a specific server connection.
   * Provides the server ID and the error object.
   */
  serverError: [serverId: string, error: Error];

  /**
   * Fired when the available capabilities (tools, resources, prompts) change.
   * No arguments are passed with this event.
   */
  capabilitiesUpdated: [];

  /**
   * Fired when a resource that has been subscribed to is updated.
   * Provides the server ID and the URI of the updated resource.
   */
  resourceUpdated: [serverId: string, uri: string];

  /**
   * Fired when a server requests an LLM sampling operation.
   * Provides the server ID, sampling request parameters, and a callback function.
   */
  samplingRequest: [
    serverId: string,
    request: CreateMessageRequest["params"],
    callback: (result: CreateMessageResult | McpError) => void
  ];

  /**
   * Fired for internal logs and logs forwarded from connected servers.
   * Provides the log level, message, and optional additional data.
   */
  log: [level: string, message: string, data?: unknown];
};

/**
 * Simplified result type for LLM responses in the simplified sampling handler.
 * Contains the essential fields for a text response, with optional metadata.
 */
export interface SimplifiedLlmResult {
  /** The core text/response content from the LLM */
  content: string;
  /** Optional: Model name that was used */
  model?: string;
  /** Optional: Reason why the generation stopped (defaults to 'endTurn') */
  stopReason?: string;
  /** Optional: Token usage statistics */
  usage?: {
    /** Number of tokens in the prompt */
    promptTokens?: number;
    /** Number of tokens in the completion */
    completionTokens?: number;
    /** Total tokens used (prompt + completion) */
    totalTokens?: number;
  };
}

/**
 * Simplified handler type for sampling requests that allows users to focus on just
 * implementing the core LLM call without having to handle the MCP protocol details.
 */
export type SimplifiedSamplingHandler = (
  serverId: string,
  params: CreateMessageRequest["params"]
) => Promise<SimplifiedLlmResult | McpError>;

/**
 * Progress information, including optional message.
 * Extends the SDKProgress type.
 */
export interface Progress extends SDKProgress {
  /** Optional descriptive message about the progress */
  message?: string;
}

/**
 * Callback type for reporting progress during long-running operations.
 */
export type ProgressCallback = (progress: Progress) => void;

/**
 * Options for configuring request operations.
 * Allows setting progress callbacks, timeouts, and cancellation signals.
 */
export type McpRequestOptions = {
  /** Optional callback to report progress during the operation */
  onprogress?: ProgressCallback;
  /** Optional AbortSignal to allow cancellation of the request */
  signal?: AbortSignal;
  /** Optional timeout in milliseconds for the request */
  timeout?: number;
  /** Whether to reset the timeout each time progress is reported */
  resetTimeoutOnProgress?: boolean;
  /** Optional maximum total timeout for the request */
  maxTotalTimeout?: number;
};

// Maintain backward compatibility with existing code
export type RequestOptions = McpRequestOptions;

/**
 * Represents the capabilities of a server.
 * Defines what features and operations a server supports.
 * Aligned with MCP 2025-03-26.
 */
export interface ServerCapabilities {
  /** Supported tools */
  tools?: { listChanged?: boolean } | Record<string, unknown>;
  /** Supported resources */
  resources?:
    | {
        subscribe?: boolean;
        listChanged?: boolean;
        templates?: boolean;
      }
    | Record<string, unknown>;
  /** Supported prompts */
  prompts?: { listChanged?: boolean } | Record<string, unknown>;
  /** Root management capabilities */
  roots?: { listChanged?: boolean } | Record<string, unknown>;
  /** Logging capabilities */
  logging?: Record<string, unknown> | boolean;
  /** Completion capabilities */
  completions?: Record<string, unknown> | boolean;
  /** Experimental features */
  experimental?: any;
  /** Allow any additional capabilities */
  [key: string]: unknown;
}

// Re-export types from SDK for convenience
export type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  CallToolRequest,
  ReadResourceRequest,
  GetPromptRequest,
  CreateMessageRequest,
  CreateMessageResult,
  Root,
  ClientCapabilities,
  McpError,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  Implementation,
  TextContent,
  ImageContent,
  AudioContent,
};

// --- NEW: Define Content union including Audio ---
export type Content = TextContent | ImageContent | AudioContent;

// --- Define ToolAnnotations type if not available in SDK ---
export type ToolAnnotations = Record<string, any>;

/** Transport type for streamable HTTP transport */
export type StreamableHTTPTransport = "streamable-http";
