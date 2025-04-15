export { McpClientHost } from "./api.js";
export type { McpHostConfig } from "./core.js";
export { McpHostError, ErrorCodes } from "./errors.js";
export type { ServerSuggestion } from "./uri-utils.js";
export type {
  AggregatedTool,
  AggregatedResource,
  AggregatedResourceTemplate,
  AggregatedPrompt,
  RequestOptions,
  McpRequestOptions,
  SimplifiedSamplingHandler,
  ServerConfig,
  Progress,
  ProgressCallback,
  // Export Tool interface to fix the errors in the chatbot app
  Tool,
} from "./types.js";

// Re-export key types from the MCP SDK for user convenience
export { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

export type {
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  CreateMessageResult,
  CreateMessageRequest,
  Root,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";
