import path from "path";
import { EventEmitter } from "events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
  Root,
  McpError,
  ErrorCode,
  // Schemas for handlers:
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  LoggingMessageNotificationSchema,
  CreateMessageRequestSchema,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { McpHostError, ErrorCodes } from "./errors.js";
import {
  McpHostConfig,
  ServerConfig,
  McpHostEvents,
  AggregatedTool,
  AggregatedResource,
  AggregatedResourceTemplate,
  AggregatedPrompt,
  ServerCapabilities,
  SimplifiedSamplingHandler,
  StreamableHttpServerConfig,
} from "./types.js";

// Re-export McpHostConfig directly from core.ts so tests can import it from here
export type { McpHostConfig } from "./types.js";

/**
 * Core implementation of the MCP Client Host.
 * Handles connections, event management, and aggregation of capabilities.
 */
export class McpClientHostCore extends EventEmitter<McpHostEvents> {
  protected config: McpHostConfig;
  protected clients: Map<string, Client> = new Map();
  protected serverConfigs: Map<string, ServerConfig> = new Map();
  protected aggregatedTools: Map<string, AggregatedTool> = new Map(); // Key: serverId/toolName
  protected aggregatedResources: Map<string, AggregatedResource> = new Map(); // Key: serverId/resourceUri
  protected aggregatedResourceTemplates: Map<
    string,
    AggregatedResourceTemplate
  > = new Map(); // Key: serverId/templateName
  protected aggregatedPrompts: Map<string, AggregatedPrompt> = new Map(); // Key: serverId/promptName
  protected currentRoots: Root[] = [];
  protected isStarted = false;
  // Store server capabilities
  protected serverCapabilities: Map<string, ServerCapabilities> = new Map();

  /** Storage for the simplified sampling handler if set */
  protected simplifiedSamplingHandler?: SimplifiedSamplingHandler;

  constructor(config: McpHostConfig) {
    super();
    this.config = config;
    this.config.servers.forEach((serverConf) => {
      if (this.serverConfigs.has(serverConf.id)) {
        this.log(
          "warn",
          `Duplicate server ID "${serverConf.id}" in configuration. Skipping.`
        );
      } else {
        this.serverConfigs.set(serverConf.id, serverConf);
      }
    });
  }

  /**
   * Sets a simplified handler for sampling requests.
   * This provides an easier way to implement sampling without managing the full MCP protocol details.
   *
   * @param handler The simplified sampling handler function
   * @returns This instance, for method chaining
   *
   * @example
   * ```typescript
   * host.setSamplingHandler(async (serverId, params) => {
   *   try {
   *     // Just implement your core LLM call logic
   *     const llmResponse = await myLlmService.generateText(params.messages);
   *     return {
   *       content: llmResponse,
   *       // Optional fields:
   *       model: "my-model-name",
   *       usage: { promptTokens: 100, completionTokens: 50 }
   *     };
   *   } catch (error) {
   *     return new McpError(ErrorCode.InternalError, `LLM error: ${error.message}`);
   *   }
   * });
   * ```
   */
  setSamplingHandler(handler: SimplifiedSamplingHandler): this {
    this.simplifiedSamplingHandler = handler;

    // Register our internal handler to bridge between the simplified handler and the MCP protocol
    this.on("samplingRequest", async (serverId, request, callback) => {
      if (!this.simplifiedSamplingHandler) {
        callback(
          new McpError(
            ErrorCode.InternalError,
            "Simplified sampling handler was removed after being set",
            { data: { serverId } }
          )
        );
        return;
      }

      try {
        // Call the user's simplified handler
        const result = await this.simplifiedSamplingHandler(serverId, request);

        if (result instanceof McpError) {
          // Pass through MCP errors directly
          callback(result);
        } else {
          // Map the simplified result to the full CreateMessageResult format
          const messageResult: CreateMessageResult = {
            role: "assistant",
            content: {
              type: "text",
              text: result.content,
            },
            model: result.model || "unknown", // Default value if not provided
            stopReason: result.stopReason || "endTurn",
            usage: result.usage,
          };
          callback(messageResult);
        }
      } catch (error) {
        // Handle any errors that occur during the simplified handler execution
        let mcpError: McpError;

        if (error instanceof McpError) {
          mcpError = error;
        } else if (error instanceof Error) {
          mcpError = new McpError(
            ErrorCode.InternalError,
            `Error in sampling handler: ${error.message}`,
            { data: { serverId } }
          );
        } else {
          mcpError = new McpError(
            ErrorCode.InternalError,
            "Unknown error in sampling handler",
            { data: { serverId } }
          );
        }

        callback(mcpError);
      }
    });

    return this;
  }

  protected log(level: string, message: string, data?: unknown) {
    // Emit event using correct tuple signature
    this.emit("log", level, message, data);
    // Optional: console log based on level
    // if (level === 'error') console.error(`[MCP HOST] ${message}`, data);
    // else if (level === 'warn') console.warn(`[MCP HOST] ${message}`, data);
    // else console.log(`[MCP HOST] ${level}: ${message}`, data || '');
  }

  /**
   * Starts connecting to all configured MCP servers.
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.log("warn", "Host already started.");
      return;
    }
    this.isStarted = true;
    this.log("info", "Starting McpClientHost...");

    const connectionPromises = Array.from(this.serverConfigs.values()).map(
      (serverConf) => this.connectToServer(serverConf)
    );

    await Promise.allSettled(connectionPromises); // Wait for all initial connection attempts
    this.log("info", "McpClientHost startup complete.");
    // Initial capability update after attempting all connections
    this.emit("capabilitiesUpdated"); // Correct: Emit with no arguments
  }

  /**
   * Disconnects from all MCP servers.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      this.log("warn", "Host not started.");
      return;
    }
    this.log("info", "Stopping McpClientHost...");
    const disconnectionPromises = Array.from(this.clients.values()).map(
      (client) =>
        client
          .close()
          .catch((e) => this.log("error", `Error closing client: ${e}`))
    );
    await Promise.allSettled(disconnectionPromises);
    this.clients.clear();
    this.clearAggregatedCapabilities();
    this.isStarted = false;
    this.log("info", "McpClientHost stopped.");
    this.emit("capabilitiesUpdated"); // Correct: Emit with no arguments
  }

  private async connectToServer(serverConf: ServerConfig): Promise<void> {
    const serverId = serverConf.id;

    this.log("info", `Connecting to: ${serverId} (${serverConf.transport})`);
    let transport: Transport | undefined;
    try {
      switch (serverConf.transport) {
        case "stdio": {
          const effectiveCwd = serverConf.cwd
            ? path.resolve(serverConf.cwd)
            : process.cwd();
          const localBinPath = path.join(effectiveCwd, "node_modules", ".bin");
          const currentPath = process.env.PATH || "";
          const newPath = [localBinPath, currentPath].join(path.delimiter);
          const fullEnv = {
            ...process.env,
            ...serverConf.env,
            PATH: newPath,
          };
          const stdioParams: StdioServerParameters = {
            command: serverConf.command,
            args: serverConf.args,
            env: fullEnv,
            cwd: effectiveCwd,
          };
          transport = new StdioClientTransport(stdioParams);
          break;
        }
        case "sse":
          this.log(
            "warn",
            `Server ${serverId} uses deprecated 'sse' transport. Consider updating to 'streamable-http'.`
          );
          transport = new SSEClientTransport(
            new URL(serverConf.url),
            serverConf.options
          );
          break;
        case "websocket":
          transport = new WebSocketClientTransport(new URL(serverConf.url));
          break;
        case "streamable-http": {
          try {
            // Streamable HTTP transport is not yet available in the official SDK
            // This is a future-proofing code path that will work once it's released
            throw new Error(
              "StreamableHttpClientTransport is not yet available in the current SDK version. " +
                "Please check for updates to @modelcontextprotocol/sdk package."
            );

            // Keep the dynamic import code for future use once the module becomes available
            /* 
            // Dynamically import the transport module
            const module = await import(
              "@modelcontextprotocol/sdk/client/streamable-http.js"
            ).catch(() => {
              // Module not available, will throw error below
              return null;
            });

            if (!module || !module.StreamableHttpClientTransport) {
              throw new Error(
                "StreamableHttpClientTransport module not available"
              );
            }

            const { StreamableHttpClientTransport } = module;
            const config = serverConf as StreamableHttpServerConfig;
            transport = new StreamableHttpClientTransport(new URL(config.url), {
              headers: config.headers,
            });
            */
          } catch (error) {
            throw new McpHostError(
              `Failed to load StreamableHttpClientTransport module: ${
                error instanceof Error ? error.message : String(error)
              }`,
              ErrorCodes.INVALID_TRANSPORT,
              { serverId }
            );
          }
          break;
        }
        default:
          const invalidTransport = (serverConf as any).transport;
          throw new McpHostError(
            `Unsupported transport type: ${invalidTransport}`,
            ErrorCodes.INVALID_TRANSPORT,
            { serverId: serverId }
          );
      }

      // Ensure transport is defined before proceeding
      if (!transport) {
        throw new McpHostError(
          "Failed to create transport",
          ErrorCodes.INVALID_TRANSPORT,
          { serverId }
        );
      }

      const clientOptions = {
        ...(serverConf.clientOptions || {}),
        capabilities: this.config.hostCapabilities,
        protocolVersion: "2025-03-26",
      };

      const client = new Client(this.config.hostInfo, clientOptions);

      client.onclose = (data?: { code?: number; reason?: string }) => {
        const error =
          data?.code !== undefined || data?.reason !== undefined
            ? new Error(
                `Connection closed with code ${data?.code ?? "unknown"}${
                  data?.reason ? `: ${data.reason}` : ""
                }`
              )
            : undefined;
        this.handleServerDisconnection(serverId, error);
      };
      client.onerror = (error) => {
        this.log("error", `Error from server ${serverId}`, error);
        this.emit("serverError", serverId, error);
      };

      // --- Handle Sampling Request ---
      if (this.config.hostCapabilities?.sampling) {
        client.setRequestHandler(
          CreateMessageRequestSchema,
          async (request) => {
            return new Promise((resolve, reject) => {
              this.emit(
                "samplingRequest",
                serverId,
                request.params,
                (result) => {
                  if (result instanceof McpError) {
                    reject(result);
                  } else {
                    resolve(result);
                  }
                }
              );
            });
          }
        );
      }
      // --- End Sampling Handling ---

      // --- Handle Capability Update Notifications ---
      const capabilityUpdateHandler = () =>
        this.updateServerCapabilities(serverId, client);
      client.setNotificationHandler(
        ToolListChangedNotificationSchema,
        capabilityUpdateHandler
      );
      client.setNotificationHandler(
        ResourceListChangedNotificationSchema,
        capabilityUpdateHandler
      );
      client.setNotificationHandler(
        PromptListChangedNotificationSchema,
        capabilityUpdateHandler
      );

      // Handle resource update notifications
      client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        (notification) => {
          const uri = notification.params.uri;
          this.log("info", `Resource updated on server ${serverId}: ${uri}`);
          this.emit("resourceUpdated", serverId, uri);
        }
      );
      // --- End Capability Update Notifications ---

      // --- Handle Logging ---
      client.setNotificationHandler(
        LoggingMessageNotificationSchema,
        (notification) => {
          this.log(
            `server-${notification.params.level}`,
            `[${serverId}${
              notification.params.logger ? "/" + notification.params.logger : ""
            }] ${notification.params.message}`,
            notification.params.data
          );
        }
      );
      // --- End Logging ---

      await client.connect(transport);

      // --- Handle Roots ---
      const serverCaps = client.getServerCapabilities();
      if (
        this.currentRoots.length > 0 &&
        serverCaps?.roots &&
        typeof serverCaps.roots === "object" &&
        (serverCaps.roots as Record<string, unknown>)["listChanged"] === true
      ) {
        try {
          await client.sendRootsListChanged();
          this.log(
            "info",
            `Sent initial roots list change notification to ${serverId}`
          );
        } catch (e: any) {
          this.log(
            "warn",
            `Failed to send initial roots list changed to ${serverId}`,
            e
          );
        }
      } else if (this.currentRoots.length > 0 && serverCaps?.roots) {
        this.log(
          "debug",
          `Server ${serverId} supports roots, but not list change notifications.`
        );
      }
      // --- End Roots Handling ---

      this.clients.set(serverId, client);
      this.log("info", `Successfully connected to server: ${serverId}`);
      this.emit("serverConnected", serverId, client);

      await this.updateServerCapabilities(serverId, client);
    } catch (error: any) {
      this.log(
        "error",
        `Failed to connect to server ${serverId}: ${error.message}`,
        error
      );
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      if (errorInstance instanceof McpHostError && !errorInstance.serverId) {
        (errorInstance as any).serverId = serverId;
      } else if (!(errorInstance instanceof McpHostError)) {
        const wrappedError = new McpHostError(
          `Connection failed for ${serverId}: ${errorInstance.message}`,
          ErrorCodes.CONNECTION_FAILED,
          { serverId: serverId, cause: errorInstance }
        );
        this.emit("serverError", serverId, wrappedError);
      } else {
        this.emit("serverError", serverId, errorInstance);
      }

      if (transport && !this.clients.has(serverId)) {
        await transport
          .close()
          .catch((e) =>
            this.log("error", `Error closing transport for ${serverId}`, e)
          );
      }
    }
  }

  protected handleServerDisconnection(
    serverId: string,
    error?: Error | { code?: number; reason?: string }
  ): void {
    // Convert close data to Error if it's not already an Error instance
    let errorObj: Error | undefined = undefined;

    if (error && !(error instanceof Error)) {
      // If we have code/reason data from WebSocket close event, create an Error
      const reason = error.reason || "Unknown reason";
      const code =
        error.code !== undefined ? String(error.code) : "unknown code";
      errorObj = new Error(`Connection closed: ${reason} (${code})`);
    } else if (error instanceof Error) {
      errorObj = error;
    }

    this.log(
      errorObj ? "error" : "info",
      `Server disconnected: ${serverId}${
        errorObj ? ` (${errorObj.message})` : ""
      }`
    );

    const client = this.clients.get(serverId);
    if (client) {
      this.clients.delete(serverId);
      this.removeServerCapabilities(serverId);
      this.emit("serverDisconnected", serverId, errorObj);
      this.emit("capabilitiesUpdated");
    }
  }

  protected async updateServerCapabilities(
    serverId: string,
    client: Client
  ): Promise<void> {
    this.log("info", `Updating capabilities for server: ${serverId}`);
    this.removeServerCapabilities(serverId);

    const capabilities = client.getServerCapabilities();
    if (!capabilities) {
      this.log("warn", `Server ${serverId} reported no capabilities.`);
      this.emit("capabilitiesUpdated");
      return;
    }

    // Store server capabilities
    this.serverCapabilities.set(serverId, capabilities);

    const promises: Promise<unknown>[] = [];

    if (capabilities.tools) {
      promises.push(
        client
          .listTools()
          .then((result) => this.addTools(serverId, result.tools))
          .catch((e) =>
            this.log("error", `Failed to list tools for ${serverId}`, e)
          )
      );
    }
    if (capabilities.resources) {
      promises.push(
        client
          .listResources()
          .then((result) => this.addResources(serverId, result.resources))
          .catch((e) =>
            this.log("error", `Failed to list resources for ${serverId}`, e)
          )
      );

      if (capabilities.resources.templates) {
        promises.push(
          client
            .listResourceTemplates()
            .then((result) =>
              this.addResourceTemplates(serverId, result.resourceTemplates)
            )
            .catch((e) =>
              this.log(
                "error",
                `Failed to list resource templates for ${serverId}`,
                e
              )
            )
        );
      } else {
        this.log(
          "debug",
          `Server ${serverId} does not support resource templates.`
        );
      }
    } else {
      this.log(
        "debug",
        `Server ${serverId} does not declare resources capability.`
      );
    }

    if (capabilities.prompts) {
      promises.push(
        client
          .listPrompts()
          .then((result) => this.addPrompts(serverId, result.prompts))
          .catch((e) =>
            this.log("error", `Failed to list prompts for ${serverId}`, e)
          )
      );
    }

    await Promise.allSettled(promises);
    this.log("info", `Finished updating capabilities for server: ${serverId}`);
    this.emit("capabilitiesUpdated");
  }

  private addTools(serverId: string, tools: Tool[]): void {
    (tools || []).forEach((tool) => {
      const key = `${serverId}/${tool.name}`;
      // Only add annotations if they exist
      const toolObj: any = {
        ...tool,
        serverId,
      };

      // Only add annotations property if it exists and is not undefined
      const annotations = (tool as any).annotations;
      if (annotations !== undefined) {
        toolObj.annotations = annotations;
      }

      this.aggregatedTools.set(key, toolObj);
    });
  }

  private addResources(serverId: string, resources: Resource[]): void {
    (resources || []).forEach((resource) => {
      const key = `${serverId}/${resource.uri}`;
      // Create base resource with serverId
      const resourceObj: any = {
        ...resource,
        serverId,
      };

      // Only add size property if it exists and is a number
      const size = (resource as any).size;
      if (typeof size === "number") {
        resourceObj.size = size;
      }

      this.aggregatedResources.set(key, resourceObj);
    });
  }

  private addResourceTemplates(
    serverId: string,
    templates: ResourceTemplate[]
  ): void {
    templates.forEach((template) => {
      const key = `${serverId}/${template.id}`;
      this.aggregatedResourceTemplates.set(key, {
        ...template,
        serverId,
      });
    });
  }

  private addPrompts(serverId: string, prompts: Prompt[]): void {
    (prompts || []).forEach((prompt) => {
      const key = `${serverId}/${prompt.name}`;
      this.aggregatedPrompts.set(key, { ...prompt, serverId });
    });
  }

  private removeServerCapabilities(serverId: string): void {
    const keysToDelete = <
      K extends string | number | symbol,
      V extends { serverId: string }
    >(
      map: Map<K, V>
    ): K[] =>
      Array.from(map.entries())
        .filter(([, value]) => value.serverId === serverId)
        .map(([key]) => key);

    keysToDelete(this.aggregatedTools).forEach((key) =>
      this.aggregatedTools.delete(key)
    );
    keysToDelete(this.aggregatedResources).forEach((key) =>
      this.aggregatedResources.delete(key)
    );
    keysToDelete(this.aggregatedResourceTemplates).forEach((key) =>
      this.aggregatedResourceTemplates.delete(key)
    );
    keysToDelete(this.aggregatedPrompts).forEach((key) =>
      this.aggregatedPrompts.delete(key)
    );

    // Also remove from serverCapabilities map
    this.serverCapabilities.delete(serverId);
  }

  private clearAggregatedCapabilities(): void {
    this.aggregatedTools.clear();
    this.aggregatedResources.clear();
    this.aggregatedResourceTemplates.clear();
    this.aggregatedPrompts.clear();
  }

  protected getClientOrThrow(serverId: string): Client {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new McpHostError("Server not found", ErrorCodes.SERVER_NOT_FOUND, {
        serverId,
      });
    }
    return client;
  }

  async subscribeToResource(serverId: string, uri: string): Promise<void> {
    const client = this.getClientOrThrow(serverId);

    try {
      await client.subscribeResource({ uri });
      this.log(
        "info",
        `Subscribed to resource updates for ${uri} on server ${serverId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpHostError(
        `Failed to subscribe to resource: ${message}`,
        ErrorCodes.SUBSCRIPTION_FAILED,
        {
          serverId,
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  async unsubscribeFromResource(serverId: string, uri: string): Promise<void> {
    const client = this.getClientOrThrow(serverId);

    try {
      await client.unsubscribeResource({ uri });
      this.log(
        "info",
        `Unsubscribed from resource updates for ${uri} on server ${serverId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpHostError(
        `Failed to unsubscribe from resource: ${message}`,
        ErrorCodes.SUBSCRIPTION_FAILED,
        {
          serverId,
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }
}
