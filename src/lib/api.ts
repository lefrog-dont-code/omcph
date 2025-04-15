import {
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  Root,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { McpHostError, ErrorCodes } from "./errors.js";
import {
  McpHostConfig,
  ServerConfig,
  AggregatedTool,
  AggregatedResource,
  AggregatedResourceTemplate,
  AggregatedPrompt,
  McpRequestOptions,
  RequestOptions,
  ServerCapabilities,
  SimplifiedSamplingHandler,
} from "./types.js";
import { McpClientHostCore } from "./core.js";
import { ServerSuggestion } from "./uri-utils.js";
import {
  resolveResourceServer,
  resolveToolServer,
  resolvePromptServer,
} from "./uri-utils.js";

/**
 * Public API for the MCP Client Host.
 * Provides methods for interacting with MCP servers and managing connections.
 *
 * @example
 * ```typescript
 * // Create a new host instance with configuration
 * const host = new McpClientHost({
 *   hostInfo: { name: "MyApp", version: "1.0.0" },
 *   hostCapabilities: { sampling: {} },
 *   servers: [
 *     {
 *       id: "filesystem",
 *       transport: "stdio",
 *       command: "npx",
 *       args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"],
 *     }
 *   ]
 * });
 *
 * // Start the host to establish connections to servers
 * await host.start();
 * ```
 */
export class McpClientHost extends McpClientHostCore {
  /**
   * Creates a new MCP Client Host instance.
   *
   * @param config - Configuration object specifying host information, capabilities,
   *                 and server connections.
   */
  constructor(config: McpHostConfig) {
    super(config);
  }

  /**
   * Get a list of all tools available from connected servers.
   *
   * @returns An array of aggregated tools, each containing the tool definition
   *          and the serverId of the server providing it.
   *
   * @example
   * ```typescript
   * // Get all available tools across all connected servers
   * const tools = host.getTools();
   *
   * // Filter tools by name
   * const searchTools = tools.filter(tool => tool.name.includes('search'));
   * ```
   */
  getTools(): AggregatedTool[] {
    return Array.from(this.aggregatedTools.values());
  }

  /**
   * Get a list of all concrete resources available from connected servers.
   * These are resources that can be directly accessed by URI, without
   * requiring template parameter substitution.
   *
   * @returns An array of aggregated resources, each containing the resource definition
   *          and the serverId of the server providing it.
   *
   * @example
   * ```typescript
   * // Get all available resources across all connected servers
   * const resources = host.getResources();
   *
   * // Filter resources by URI pattern
   * const imageResources = resources.filter(resource =>
   *   resource.uri.startsWith('image:'));
   * ```
   */
  getResources(): AggregatedResource[] {
    return Array.from(this.aggregatedResources.values());
  }

  /**
   * Get a list of all resource templates available from connected servers.
   * Resource templates define parameterized URIs that can be used to access
   * dynamic resources by providing parameter values.
   *
   * @returns An array of aggregated resource templates, each containing the template definition
   *          and the serverId of the server providing it.
   *
   * @example
   * ```typescript
   * // Get all available resource templates
   * const templates = host.getResourceTemplates();
   *
   * // Find a specific template
   * const fileTemplate = templates.find(template =>
   *   template.name === 'file');
   * ```
   */
  getResourceTemplates(): AggregatedResourceTemplate[] {
    return Array.from(this.aggregatedResourceTemplates.values());
  }

  /**
   * Get a list of all prompts available from connected servers.
   *
   * @returns An array of aggregated prompts, each containing the prompt definition
   *          and the serverId of the server providing it.
   *
   * @example
   * ```typescript
   * // Get all available prompts
   * const prompts = host.getPrompts();
   *
   * // Find prompts for a specific task
   * const codePrompts = prompts.filter(prompt =>
   *   prompt.name.includes('code'));
   * ```
   */
  getPrompts(): AggregatedPrompt[] {
    return Array.from(this.aggregatedPrompts.values());
  }

  /**
   * Call a tool on a specific server.
   *
   * @param serverId - The unique identifier of the server hosting the tool.
   * @param params - The tool request parameters, including the tool name and arguments.
   * @param options - Optional request configuration like progress callbacks or timeout.
   *
   * @returns A promise that resolves to the tool execution result.
   *
   * @throws {McpError} If the server returns an error or if the tool execution fails.
   * @throws {McpHostError} With code SERVER_NOT_FOUND if the specified server is not connected.
   * @throws {McpHostError} With code TOOL_CALL_FAILED for other execution errors.
   *
   * @example
   * ```typescript
   * try {
   *   const result = await host.callTool('filesystem', {
   *     name: 'readFile',
   *     arguments: { path: '/path/to/file.txt' }
   *   });
   *   console.log('Tool result:', result);
   * } catch (error) {
   *   if (error instanceof McpError) {
   *     console.error(`MCP Error: ${error.code} - ${error.message}`);
   *   } else if (error instanceof McpHostError) {
   *     console.error(`Host Error: ${error.code} - ${error.message}`);
   *   }
   * }
   * ```
   */
  async callTool(
    serverId: string,
    params: any,
    options?: McpRequestOptions
  ): Promise<CallToolResult> {
    const client = this.getClientOrThrow(serverId);
    return client.callTool(
      params,
      CallToolResultSchema,
      options
    ) as Promise<CallToolResult>;
  }

  /**
   * Read a resource from a specific server.
   * Note: Determining *which* server provides a URI might require inspecting
   * getResources() and getResourceTemplates() first, or implementing custom routing logic.
   *
   * @param serverId - The unique identifier of the server hosting the resource.
   * @param params - The resource request parameters, containing the URI to read.
   * @param options - Optional request configuration like progress callbacks or timeout.
   *
   * @returns A promise that resolves to the resource content.
   *
   * @throws {McpError} If the server returns an error or if the resource cannot be read.
   * @throws {McpHostError} With code SERVER_NOT_FOUND if the specified server is not connected.
   * @throws {McpHostError} With code RESOURCE_READ_FAILED for other read errors.
   *
   * @example
   * ```typescript
   * try {
   *   const resource = await host.readResource('filesystem', {
   *     uri: 'file:///path/to/file.txt'
   *   });
   *   console.log('Resource content:', resource);
   * } catch (error) {
   *   if (error instanceof McpError) {
   *     console.error(`MCP Error: ${error.code} - ${error.message}`);
   *   } else if (error instanceof McpHostError) {
   *     console.error(`Host Error: ${error.code} - ${error.message}`);
   *   }
   * }
   * ```
   */
  async readResource(
    serverId: string,
    params: any,
    options?: McpRequestOptions
  ): Promise<ReadResourceResult> {
    const client = this.getClientOrThrow(serverId);
    return client.readResource(params, options);
  }

  /**
   * Get a prompt from a specific server.
   *
   * @param serverId - The unique identifier of the server hosting the prompt.
   * @param params - The prompt request parameters, including name and optional arguments.
   * @param options - Optional request configuration like progress callbacks or timeout.
   *
   * @returns A promise that resolves to the prompt content.
   *
   * @throws {McpError} If the server returns an error or if the prompt is not found.
   * @throws {McpHostError} With code SERVER_NOT_FOUND if the specified server is not connected.
   * @throws {McpHostError} With code PROMPT_GET_FAILED for other retrieval errors.
   *
   * @example
   * ```typescript
   * try {
   *   const prompt = await host.getPrompt('promptServer', {
   *     name: 'greetingPrompt',
   *     arguments: { name: 'John' }
   *   });
   *   console.log('Prompt:', prompt);
   * } catch (error) {
   *   if (error instanceof McpError) {
   *     console.error(`MCP Error: ${error.code} - ${error.message}`);
   *   } else if (error instanceof McpHostError) {
   *     console.error(`Host Error: ${error.code} - ${error.message}`);
   *   }
   * }
   * ```
   */
  async getPrompt(
    serverId: string,
    params: any,
    options?: McpRequestOptions
  ): Promise<GetPromptResult> {
    const client = this.getClientOrThrow(serverId);
    return client.getPrompt(params, options);
  }

  /**
   * Set the filesystem roots for all connected servers that support them.
   * Roots define the boundaries where servers can operate within the filesystem.
   *
   * @param roots - An array of Root objects, each containing a URI and name.
   *
   * @returns A promise that resolves when all roots have been set.
   *
   * @throws {McpHostError} With code ROOTS_UPDATE_FAILED if setting roots fails.
   * @throws {AggregateError} Containing multiple McpHostError instances if multiple servers fail.
   *
   * @example
   * ```typescript
   * try {
   *   await host.setRoots([
   *     { uri: 'file:///projects/main', name: 'Main Project' },
   *     { uri: 'file:///projects/docs', name: 'Documentation' }
   *   ]);
   *   console.log('Roots set successfully');
   * } catch (error) {
   *   if (error instanceof AggregateError) {
   *     console.error(`Multiple errors (${error.errors.length}):`);
   *     error.errors.forEach((err, i) => {
   *       console.error(`  ${i + 1}. ${err.message}`);
   *     });
   *   } else {
   *     console.error('Error setting roots:', error);
   *   }
   * }
   * ```
   */
  async setRoots(roots: Root[]): Promise<void> {
    if (!Array.isArray(roots)) {
      throw new McpHostError(
        "Roots must be an array",
        ErrorCodes.ROOTS_UPDATE_FAILED
      );
    }

    this.currentRoots = roots;
    const errors: McpHostError[] = [];

    await Promise.allSettled(
      Array.from(this.clients.entries()).map(async ([serverId, client]) => {
        const serverCaps = client.getServerCapabilities() as ServerCapabilities;
        if (serverCaps?.roots?.listChanged) {
          try {
            await client.sendRootsListChanged();
            this.log(
              "info",
              `Sent roots list changed notification to ${serverId}`
            );
          } catch (e) {
            const error = new McpHostError(
              `Failed to send roots to server ${serverId}`,
              ErrorCodes.ROOTS_UPDATE_FAILED,
              {
                serverId,
                cause: e instanceof Error ? e : undefined,
              }
            );
            errors.push(error);
            this.log("error", error.message);
          }
        }
      })
    );

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Failed to update roots on some servers"
      );
    }
  }

  /**
   * Lists the roots currently configured for the host. Servers supporting roots
   * will use this list.
   *
   * @returns An array of Root objects currently set for the host.
   *
   * @example
   * ```typescript
   * const currentRoots = host.getCurrentRoots();
   * console.log('Current roots:', currentRoots);
   * ```
   */
  getCurrentRoots(): Root[] {
    // Return a copy to prevent external modification
    return [...this.currentRoots];
  }

  /**
   * Gets the Client instance for a specific server ID.
   * Useful for accessing lower-level client methods if needed.
   *
   * @param serverId - The unique identifier of the server.
   *
   * @returns The Client instance for the specified server, or undefined if not found.
   *
   * @example
   * ```typescript
   * const client = host.getClient('filesystem');
   * if (client) {
   *   // Use client directly for advanced operations
   * }
   * ```
   */
  getClient(serverId: string): any {
    return this.clients.get(serverId);
  }

  /**
   * Gets the configuration for a specific server ID.
   *
   * @param serverId - The unique identifier of the server.
   *
   * @returns The server configuration, or undefined if not found.
   *
   * @example
   * ```typescript
   * const serverConfig = host.getServerConfig('filesystem');
   * if (serverConfig) {
   *   console.log('Server transport:', serverConfig.transport);
   * }
   * ```
   */
  getServerConfig(serverId: string): ServerConfig | undefined {
    return this.serverConfigs.get(serverId);
  }

  /**
   * Gets a map of all currently connected server IDs to their Client instances.
   *
   * @returns A readonly map of server IDs to Client instances.
   *
   * @example
   * ```typescript
   * const clients = host.getConnectedClients();
   * console.log('Connected servers:', Array.from(clients.keys()));
   * ```
   */
  getConnectedClients(): ReadonlyMap<string, any> {
    return this.clients;
  }

  /**
   * Suggest a server for a given URI.
   *
   * @param uri - The URI to find a server for.
   * @returns An array of server suggestions, sorted by confidence (highest first)
   *
   * @example
   * ```typescript
   * const suggestions = host.suggestServerForUri('file:///path/to/file.txt');
   * if (suggestions.length > 0) {
   *   const bestMatch = suggestions[0];
   *   console.log(`Best server: ${bestMatch.serverId} (confidence: ${bestMatch.confidence})`);
   * } else {
   *   console.log('No server found for this URI');
   * }
   * ```
   */
  suggestServerForUri(uri: string): ServerSuggestion[] {
    const resources = Array.from(
      this.aggregatedResources.values()
    ) as AggregatedResource[];
    const templates = Array.from(
      this.aggregatedResourceTemplates.values()
    ) as AggregatedResourceTemplate[];
    return resolveResourceServer(uri, resources, templates);
  }

  /**
   * Suggest servers that can handle a specific tool name.
   *
   * @param toolName - The name of the tool to find a server for
   * @returns An array of server suggestions, sorted by confidence (highest first)
   *
   * @example
   * ```typescript
   * const suggestions = host.suggestServerForTool('readFile');
   * if (suggestions.length > 0) {
   *   const bestMatch = suggestions[0];
   *   console.log(`Best server: ${bestMatch.serverId} (confidence: ${bestMatch.confidence})`);
   * } else {
   *   console.log('No server found for this tool');
   * }
   * ```
   */
  suggestServerForTool(toolName: string): ServerSuggestion[] {
    const tools = Array.from(this.aggregatedTools.values()) as AggregatedTool[];
    return resolveToolServer(toolName, tools);
  }

  /**
   * Suggest servers that can handle a specific prompt name.
   *
   * @param promptName - The name of the prompt to find a server for
   * @returns An array of server suggestions, sorted by confidence (highest first)
   *
   * @example
   * ```typescript
   * const suggestions = host.suggestServerForPrompt('greetingPrompt');
   * if (suggestions.length > 0) {
   *   const bestMatch = suggestions[0];
   *   console.log(`Best server: ${bestMatch.serverId} (confidence: ${bestMatch.confidence})`);
   * } else {
   *   console.log('No server found for this prompt');
   * }
   * ```
   */
  suggestServerForPrompt(promptName: string): ServerSuggestion[] {
    const prompts = Array.from(
      this.aggregatedPrompts.values()
    ) as AggregatedPrompt[];
    return resolvePromptServer(promptName, prompts);
  }
}
