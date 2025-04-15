import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { McpClientHost, McpHostConfig } from "../../src/index.js";

// Create mocks with implementation to avoid TypeScript errors
const mockConnect = jest.fn().mockImplementation(() => Promise.resolve());
const mockClose = jest.fn().mockImplementation(() => Promise.resolve());
const mockGetServerCapabilities = jest.fn().mockReturnValue({});
const mockListTools = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ tools: [] }));
const mockListResources = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ resources: [] }));
const mockListResourceTemplates = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ resourceTemplates: [] }));
const mockListPrompts = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ prompts: [] }));
const mockCallTool = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ content: "test result" }));
const mockReadResource = jest
  .fn()
  .mockImplementation(() => Promise.resolve({}));
const mockGetPrompt = jest.fn().mockImplementation(() => Promise.resolve({}));
const mockSendRootsListChanged = jest
  .fn()
  .mockImplementation(() => Promise.resolve());
const mockSetRequestHandler = jest.fn();
const mockSetNotificationHandler = jest.fn();

// Create a mock client object
const mockClient = {
  connect: mockConnect,
  close: mockClose,
  getServerCapabilities: mockGetServerCapabilities,
  listTools: mockListTools,
  listResources: mockListResources,
  listResourceTemplates: mockListResourceTemplates,
  listPrompts: mockListPrompts,
  callTool: mockCallTool,
  readResource: mockReadResource,
  getPrompt: mockGetPrompt,
  sendRootsListChanged: mockSendRootsListChanged,
  setRequestHandler: mockSetRequestHandler,
  setNotificationHandler: mockSetNotificationHandler,
  onerror: null,
  onclose: null,
};

// Mock transport factories
const mockStdioTransport = jest.fn();
const mockSseTransport = jest.fn();
const mockWebSocketTransport = jest.fn();

// Mock Client constructor
const MockClient = jest.fn(() => mockClient);

// Mock modules
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: MockClient,
  };
});

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: mockStdioTransport,
  };
});

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  return {
    SSEClientTransport: mockSseTransport,
  };
});

jest.mock("@modelcontextprotocol/sdk/client/websocket.js", () => {
  return {
    WebSocketClientTransport: mockWebSocketTransport,
  };
});

describe("McpClientHost", () => {
  // Sample config for testing
  const sampleConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      {
        id: "stdio-server",
        transport: "stdio",
        command: "test-command",
        args: ["arg1", "arg2"],
      },
    ],
    hostCapabilities: {
      sampling: {},
    },
  };

  let host: McpClientHost;

  beforeEach(() => {
    jest.clearAllMocks();
    host = new McpClientHost(sampleConfig);
  });

  afterEach(async () => {
    await host.stop();
  });

  test("constructor initializes with config", () => {
    expect(host).toBeInstanceOf(EventEmitter);
    expect(host).toBeInstanceOf(McpClientHost);
  });

  test("can be started and stopped", async () => {
    await host.start();
    await host.stop();
    // If no exception is thrown, the test passes
  });

  test("getClient returns undefined for non-existent server", () => {
    const client = host.getClient("non-existent-server");
    expect(client).toBeUndefined();
  });

  test("emits log events", () => {
    // Set up a spy for the emit method
    const emitSpy = jest.spyOn(host, "emit");

    // Call the private log method
    (host as any).log("info", "Test message");

    // Check that emit was called with the right arguments
    expect(emitSpy).toHaveBeenCalledWith(
      "log",
      "info",
      "Test message",
      undefined
    );

    emitSpy.mockRestore();
  });

  test("handles error when calling tool on non-existent server", async () => {
    await expect(
      host.callTool("non-existent-server", { name: "testTool", arguments: {} })
    ).rejects.toThrow();
  });
});
