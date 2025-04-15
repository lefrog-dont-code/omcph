import { jest } from "@jest/globals";
import { McpClientHost, McpHostConfig } from "../../src/lib/index.js";

// --- Mocks ---

// Only mock what's essential for the tests to run without external dependencies
const mockClientConnect = jest.fn(() => Promise.resolve());
const mockClientClose = jest.fn(() => Promise.resolve());
const mockClientGetCaps = jest.fn(() => ({}));

const MockClient = jest.fn(() => ({
  connect: mockClientConnect,
  close: mockClientClose,
  getServerCapabilities: mockClientGetCaps,
  setRequestHandler: jest.fn(),
  setNotificationHandler: jest.fn(),
  onerror: null,
  onclose: null,
}));

// Mock transport constructors just enough to prevent errors
const MockStdioTransport = jest.fn(() => ({
  close: jest.fn(() => Promise.resolve()),
}));
const MockSseTransport = jest.fn(() => ({
  close: jest.fn(() => Promise.resolve()),
}));
const MockWebSocketTransport = jest.fn(() => ({
  close: jest.fn(() => Promise.resolve()),
}));

// Setup module mocks
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));
jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSseTransport,
}));
jest.mock("@modelcontextprotocol/sdk/client/websocket.js", () => ({
  WebSocketClientTransport: MockWebSocketTransport,
}));

// --- Test Suite ---

describe("McpClientHost Transport Handling", () => {
  // --- Test Configurations ---
  const stdioConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [{ id: "stdio-server", transport: "stdio", command: "test" }],
  };
  const sseConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "sse-server", transport: "sse", url: "http://localhost:3000" },
    ],
  };
  const wsConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "ws-server", transport: "websocket", url: "ws://localhost:8080" },
    ],
  };
  const duplicateConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "duplicate-id", transport: "stdio", command: "test1" },
      { id: "duplicate-id", transport: "stdio", command: "test2" },
    ],
  };
  const invalidConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "invalid-transport", transport: "invalid" as any, command: "test" },
    ],
  };

  // --- Hooks ---
  beforeEach(() => {
    // Reset only essential mocks used across tests
    MockClient.mockClear();
    mockClientConnect.mockClear();
    mockClientClose.mockClear();
    // Transport mocks are simple and don't need explicit clearing usually
  });

  // --- Tests ---

  // Simplified tests: Verify start/stop don't throw for each config
  test("can start/stop with Stdio config", async () => {
    const host = new McpClientHost(stdioConfig);
    await expect(host.start()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();
  });

  test("can start/stop with SSE config", async () => {
    const host = new McpClientHost(sseConfig);
    await expect(host.start()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();
  });

  test("can start/stop with WebSocket config", async () => {
    const host = new McpClientHost(wsConfig);
    await expect(host.start()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();
  });

  test("handles client close error gracefully", async () => {
    // Make the client's close method reject
    mockClientClose.mockImplementationOnce(() =>
      Promise.reject(new Error("Client close error"))
    );

    const host = new McpClientHost(stdioConfig);
    const logSpy = jest.spyOn(host as any, "log");

    await host.start();
    await host.stop(); // Should attempt to close and log the error

    // Check if *any* error was logged during stop
    const errorLogFound = logSpy.mock.calls.some((call) => call[0] === "error");
    expect(errorLogFound).toBe(true);

    logSpy.mockRestore();
  });

  test("handles duplicate server IDs in configuration", () => {
    const logSpy = jest.spyOn(McpClientHost.prototype as any, "log");
    new McpClientHost(duplicateConfig); // Instantiation logs the warning

    expect(logSpy).toHaveBeenCalledWith(
      "warn",
      'Duplicate server ID "duplicate-id" in configuration. Skipping.'
    );
    logSpy.mockRestore();
  });

  test("handles unsupported transport type gracefully", async () => {
    const host = new McpClientHost(invalidConfig);
    const errorSpy = jest.fn();
    host.on("serverError", errorSpy);

    await host.start(); // Attempting start triggers the error path

    expect(errorSpy).toHaveBeenCalledWith(
      "invalid-transport",
      expect.objectContaining({
        message: "Unsupported transport type: invalid",
      })
    );
  });
});
