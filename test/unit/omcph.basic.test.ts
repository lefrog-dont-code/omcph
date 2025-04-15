import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { McpClientHost, McpHostConfig } from "../../src/lib/index.js";

// Mock the basic dependencies
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: jest.fn(() => ({
      connect: jest.fn(() => Promise.resolve()),
      close: jest.fn(() => Promise.resolve()),
      getServerCapabilities: jest.fn().mockReturnValue({}),
      setRequestHandler: jest.fn(),
      setNotificationHandler: jest.fn(),
    })),
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

// Basic test to verify testing setup
describe("McpClientHost Basic", () => {
  test("can be instantiated", () => {
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [],
    };

    const host = new McpClientHost(config);

    expect(host).toBeInstanceOf(EventEmitter);
    expect(host).toBeInstanceOf(McpClientHost);
  });

  test("emits log events", () => {
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [],
    };

    const host = new McpClientHost(config);

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

    // Restore the spy
    emitSpy.mockRestore();
  });

  test("can start and stop", async () => {
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [],
    };

    const host = new McpClientHost(config);

    // Should complete without errors
    await host.start();
    await host.stop();

    // No assertions needed; if it doesn't throw, it passed
  });
});
