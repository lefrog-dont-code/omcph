import { jest } from "@jest/globals";
import { McpClientHost, McpHostConfig } from "../../src/lib/index.js";

// Setup mock client with minimal functionality
const mockClient = {
  connect: jest.fn().mockImplementation(() => Promise.resolve()),
  close: jest.fn().mockImplementation(() => Promise.resolve()),
  getServerCapabilities: jest.fn().mockReturnValue({ sampling: {}, tools: {} }),
  setRequestHandler: jest.fn(),
  setNotificationHandler: jest.fn(),
};

// Mock Client constructor
const MockClient = jest.fn(() => mockClient);

// Setup mocks
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: MockClient,
  };
});

jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: jest.fn(),
  };
});

jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  return {
    SSEClientTransport: jest.fn(),
  };
});

jest.mock("@modelcontextprotocol/sdk/client/websocket.js", () => {
  return {
    WebSocketClientTransport: jest.fn(),
  };
});

describe("McpClientHost Event Handling", () => {
  const sampleConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [],
  };

  let host: McpClientHost;

  beforeEach(() => {
    jest.clearAllMocks();
    host = new McpClientHost(sampleConfig);
  });

  afterEach(async () => {
    await host.stop();
  });

  test("emits log events", () => {
    const logSpy = jest.fn();
    host.on("log", logSpy);

    // Call the private log method
    (host as any).log("info", "Test message", { data: "test" });

    expect(logSpy).toHaveBeenCalledWith("info", "Test message", {
      data: "test",
    });
  });

  test("emits capabilitiesUpdated after start", async () => {
    const capUpdateSpy = jest.fn();
    host.on("capabilitiesUpdated", capUpdateSpy);

    await host.start();

    expect(capUpdateSpy).toHaveBeenCalled();
  });
});
