import { jest } from "@jest/globals";
import {
  McpClientHost,
  McpHostConfig,
  McpRequestOptions,
  Progress,
} from "../../src/index.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { McpHostError, ErrorCodes } from "../../src/errors.js";

// Mock API methods from the SDK Client
const mockCallTool = jest
  .fn<() => Promise<{ result: string }>>()
  .mockResolvedValue({ result: "tool result" });
const mockReadResource = jest
  .fn<() => Promise<{ content: string }>>()
  .mockResolvedValue({ content: "resource content" });
const mockGetPrompt = jest
  .fn<() => Promise<{ text: string }>>()
  .mockResolvedValue({ text: "prompt text" });
const mockSendRootsListChanged = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockListTools = jest
  .fn<() => Promise<{ tools: Array<{ id: string; name: string }> }>>()
  .mockResolvedValue({ tools: [{ id: "tool1", name: "Tool 1" }] });
const mockListResources = jest
  .fn<() => Promise<{ resources: Array<{ id: string; name: string }> }>>()
  .mockResolvedValue({ resources: [{ id: "resource1", name: "Resource 1" }] });
const mockListResourceTemplates = jest
  .fn<
    () => Promise<{ resourceTemplates: Array<{ id: string; name: string }> }>
  >()
  .mockResolvedValue({
    resourceTemplates: [{ id: "template1", name: "Template 1" }],
  });
const mockListPrompts = jest
  .fn<() => Promise<{ prompts: Array<{ id: string; name: string }> }>>()
  .mockResolvedValue({ prompts: [{ id: "prompt1", name: "Prompt 1" }] });

// Event handler references
let clientCloseHandler: any = () => {};
let clientErrorHandler: any = () => {};

// Create a mock client
const mockClient = {
  connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  callTool: mockCallTool,
  readResource: mockReadResource,
  getPrompt: mockGetPrompt,
  sendRootsListChanged: mockSendRootsListChanged,
  listTools: mockListTools,
  listResources: mockListResources,
  listResourceTemplates: mockListResourceTemplates,
  listPrompts: mockListPrompts,
  getServerCapabilities: jest.fn().mockReturnValue({
    tools: { listChanged: true },
    resources: {
      listChanged: true,
      templates: true,
    },
    prompts: { listChanged: true },
    roots: { listChanged: true },
    completions: {},
  }),
  // Mock event handler registration
  onclose: jest.fn((handler) => {
    clientCloseHandler = handler;
    return mockClient;
  }),
  onerror: jest.fn((handler) => {
    clientErrorHandler = handler;
    return mockClient;
  }),
  setRequestHandler: jest.fn(),
  setNotificationHandler: jest.fn(),
};

// Mock the SDK modules
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn(() => mockClient),
}));
jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: jest.fn(),
}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: jest.fn(),
}));
jest.mock("@modelcontextprotocol/sdk/client/websocket.js", () => ({
  WebSocketClientTransport: jest.fn(),
}));

// Helper function to add a client directly to the host
async function addClientToHost(host: McpClientHost) {
  (host as any).clients.set("test-server", mockClient);
  // Simulate event handler setup during connection
  mockClient.onclose((data: any) =>
    (host as any).handleServerDisconnection("test-server", data)
  );
  mockClient.onerror((error: any) =>
    host.emit("serverError", "test-server", error)
  );
  host.emit("serverConnected", "test-server", mockClient as any);
  await (host as any).updateServerCapabilities("test-server", mockClient);
}

describe("McpClientHost API and Events (MCP 2025-03-26)", () => {
  let host: McpClientHost;

  beforeEach(() => {
    jest.clearAllMocks();
    clientCloseHandler = () => {};
    clientErrorHandler = () => {};
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [
        { id: "test-server", transport: "stdio", command: "test-command" },
      ],
    };
    host = new McpClientHost(config);
  });

  afterEach(async () => {
    await host.stop();
  });

  describe("Event Tests", () => {
    test("emits serverConnected event when client connects", async () => {
      const emitSpy = jest.spyOn(host, "emit");
      await addClientToHost(host);
      expect(emitSpy).toHaveBeenCalledWith(
        "serverConnected",
        "test-server",
        expect.anything()
      );
      emitSpy.mockRestore();
    });

    test("emits serverDisconnected event when client closes", async () => {
      const emitSpy = jest.spyOn(host, "emit");
      await addClientToHost(host);
      emitSpy.mockClear();
      clientCloseHandler({ reason: "test-close", code: 1000 }); // Trigger close
      expect(emitSpy).toHaveBeenCalledWith(
        "serverDisconnected",
        "test-server",
        expect.any(Error)
      ); // Error object created from reason/code
      emitSpy.mockRestore();
    });

    test("emits serverError event when client has an error", async () => {
      const emitSpy = jest.spyOn(host, "emit");
      await addClientToHost(host);
      emitSpy.mockClear();
      const testError = new Error("Test error message");
      clientErrorHandler(testError); // Trigger error
      expect(emitSpy).toHaveBeenCalledWith(
        "serverError",
        "test-server",
        testError
      );
      emitSpy.mockRestore();
    });
  });

  describe("API Success Path Tests", () => {
    beforeEach(async () => {
      await addClientToHost(host);
    });

    test("callTool delegates to client with options", async () => {
      const params = { name: "tool1", arguments: { param1: "value1" } };
      const options: McpRequestOptions = { timeout: 5000 };
      const result = await host.callTool("test-server", params, options);

      // Verify the client method was called with params AND options
      expect(mockCallTool).toHaveBeenCalledWith(
        params,
        expect.anything(),
        options
      ); // Schema is passed internally
      expect(result).toEqual({ result: "tool result" });
    });

    test("readResource delegates to client with options", async () => {
      const params = { uri: "resource1" };
      const onProgress = jest.fn();
      const options: McpRequestOptions = { onprogress: onProgress };
      const result = await host.readResource("test-server", params, options);

      expect(mockReadResource).toHaveBeenCalledWith(params, options);
      expect(result).toEqual({ content: "resource content" });
      // We can't easily test if onProgress was called without modifying the mock's internals
    });

    test("getPrompt delegates to client with options", async () => {
      const params = { name: "prompt1" };
      const signal = new AbortController().signal;
      const options: McpRequestOptions = { signal };
      const result = await host.getPrompt("test-server", params, options);

      expect(mockGetPrompt).toHaveBeenCalledWith(params, options);
      expect(result).toEqual({ text: "prompt text" });
    });

    test("setRoots sends notification (options not applicable)", async () => {
      const roots = [{ uri: "file:///root1", name: "Root 1" }];
      await host.setRoots(roots);
      expect(mockSendRootsListChanged).toHaveBeenCalled(); // No options for notifications
      expect(host.getCurrentRoots()).toEqual(roots);
    });
  });

  describe("API Error Path Tests", () => {
    beforeEach(async () => {
      await addClientToHost(host);
    });

    test("callTool handles client errors correctly", async () => {
      const testError = new McpError(
        ErrorCode.InternalError,
        "Tool execution failed"
      );
      mockCallTool.mockRejectedValueOnce(testError);
      const params = { name: "tool1", arguments: {} };
      await expect(host.callTool("test-server", params)).rejects.toThrow(
        testError
      );
      expect(mockCallTool).toHaveBeenCalled();
    });

    test("readResource handles client errors correctly", async () => {
      const testError = new McpError(
        ErrorCode.MethodNotFound,
        "Resource not found"
      );
      mockReadResource.mockRejectedValueOnce(testError);
      const params = { uri: "resource1" };
      await expect(host.readResource("test-server", params)).rejects.toThrow(
        testError
      );
      expect(mockReadResource).toHaveBeenCalled();
    });

    test("getPrompt handles client errors correctly", async () => {
      const testError = new McpError(
        ErrorCode.MethodNotFound,
        "Prompt not found"
      );
      mockGetPrompt.mockRejectedValueOnce(testError);
      const params = { name: "prompt1" };
      await expect(host.getPrompt("test-server", params)).rejects.toThrow(
        testError
      );
      expect(mockGetPrompt).toHaveBeenCalled();
    });

    test("setRoots handles client errors appropriately", async () => {
      const testError = new Error("Network error during roots update");
      mockSendRootsListChanged.mockRejectedValueOnce(testError);
      const roots = [{ uri: "file:///root1", name: "Root 1" }];

      try {
        await host.setRoots(roots);
        fail("Expected setRoots to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(AggregateError);
        const aggError = e as AggregateError;
        expect(aggError.errors[0]).toBeInstanceOf(McpHostError);
        expect((aggError.errors[0] as McpHostError).code).toBe(
          ErrorCodes.ROOTS_UPDATE_FAILED
        );
        expect((aggError.errors[0] as McpHostError).cause).toBe(testError);
        // Roots should still be set internally even if notification fails
        expect(host.getCurrentRoots()).toEqual(roots);
      }
    });
  });

  describe("Progress Handling", () => {
    beforeEach(async () => {
      await addClientToHost(host);
    });

    test("callTool passes progress updates with message via onprogress callback", async () => {
      const onProgress = jest.fn();
      const options: McpRequestOptions = { onprogress: onProgress };
      const params = { name: "longTool", arguments: {} };

      // Mock the SDK client's callTool to simulate progress
      (mockCallTool.mockImplementationOnce as any)(
        async (reqParams: any, schema: any, reqOptions: any) => {
          if (reqOptions?.onprogress) {
            // Use the Progress type with message field
            const progress1: Progress = {
              progress: 50,
              total: 100,
              message: "Halfway...",
            };
            reqOptions.onprogress(progress1);

            await new Promise((res) => setTimeout(res, 10)); // Simulate work

            const progress2: Progress = {
              progress: 100,
              total: 100,
              message: "Done!",
            };
            reqOptions.onprogress(progress2);
          }
          return { result: "long tool finished" };
        }
      );

      await host.callTool("test-server", params, options);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 50,
          total: 100,
          message: "Halfway...",
        })
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 100,
          total: 100,
          message: "Done!",
        })
      );
    });

    test("request timeouts and cancellation options are passed correctly", async () => {
      const params = { name: "tool1", arguments: {} };
      const signal = new AbortController().signal;
      const options: McpRequestOptions = {
        timeout: 5000,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 30000,
        signal,
      };

      await host.callTool("test-server", params, options);

      // Verify all options were passed through
      expect(mockCallTool).toHaveBeenCalledWith(
        params,
        expect.anything(),
        expect.objectContaining({
          timeout: 5000,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: 30000,
          signal,
        })
      );
    });
  });
});
