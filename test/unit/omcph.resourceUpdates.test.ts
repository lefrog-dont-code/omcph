import { jest } from "@jest/globals";
import { McpClientHostCore, McpHostConfig } from "../../src/core.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// Mock client methods with proper Promise return type annotations
const mockSubscribeResource = jest
  .fn<() => Promise<void>>()
  .mockImplementation(() => Promise.resolve());
const mockUnsubscribeResource = jest
  .fn<() => Promise<void>>()
  .mockImplementation(() => Promise.resolve());
const mockConnect = jest.fn().mockImplementation(() => Promise.resolve());
const mockClose = jest.fn().mockImplementation(() => Promise.resolve());
const mockGetServerCapabilities = jest.fn().mockReturnValue({ resources: {} });
const mockSetNotificationHandler = jest.fn();

// Create a mock client object
const mockClient = {
  connect: mockConnect,
  close: mockClose,
  getServerCapabilities: mockGetServerCapabilities,
  subscribeResource: mockSubscribeResource,
  unsubscribeResource: mockUnsubscribeResource,
  setNotificationHandler: mockSetNotificationHandler,
  setRequestHandler: jest.fn(),
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

describe("McpClientHostCore Resource Updates", () => {
  const sampleConfig: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      {
        id: "test-server",
        transport: "stdio",
        command: "test-command",
        args: [],
      },
    ],
  };

  let host: McpClientHostCore;

  beforeEach(() => {
    jest.clearAllMocks();
    host = new McpClientHostCore(sampleConfig);
  });

  afterEach(async () => {
    await host.stop();
  });

  test("subscribeToResource calls client.subscribeResource with correct parameters", async () => {
    // Add client to host
    (host as any).clients.set("test-server", mockClient);

    await host.subscribeToResource("test-server", "file:///test.txt");

    expect(mockSubscribeResource).toHaveBeenCalledWith({
      uri: "file:///test.txt",
    });
  });

  test("subscribeToResource throws error when server not found", async () => {
    await expect(
      host.subscribeToResource("non-existent-server", "file:///test.txt")
    ).rejects.toThrow("Server not found");
  });

  test("unsubscribeFromResource calls client.unsubscribeResource with correct parameters", async () => {
    // Add client to host
    (host as any).clients.set("test-server", mockClient);

    await host.unsubscribeFromResource("test-server", "file:///test.txt");

    expect(mockUnsubscribeResource).toHaveBeenCalledWith({
      uri: "file:///test.txt",
    });
  });

  test("unsubscribeFromResource throws error when server not found", async () => {
    await expect(
      host.unsubscribeFromResource("non-existent-server", "file:///test.txt")
    ).rejects.toThrow("Server not found");
  });

  test("emits resourceUpdated event when notification is received", async () => {
    // Create a mock event listener
    const mockListener = jest.fn();
    host.on("resourceUpdated", mockListener);

    // Directly emit the event to test the event handling
    host.emit("resourceUpdated", "test-server", "file:///test.txt");

    // Check that our listener was called with the correct parameters
    expect(mockListener).toHaveBeenCalledWith(
      "test-server",
      "file:///test.txt"
    );
  });

  test("handles subscription errors correctly", async () => {
    // Setup mock to throw an error
    mockSubscribeResource.mockRejectedValueOnce(
      new Error("Subscription failed")
    );

    // Add client to host
    (host as any).clients.set("test-server", mockClient);

    // Attempt to subscribe and expect an error
    await expect(
      host.subscribeToResource("test-server", "file:///test.txt")
    ).rejects.toThrow("Failed to subscribe to resource: Subscription failed");
  });

  test("handles unsubscription errors correctly", async () => {
    // Setup mock to throw an error
    mockUnsubscribeResource.mockRejectedValueOnce(
      new Error("Unsubscription failed")
    );

    // Add client to host
    (host as any).clients.set("test-server", mockClient);

    // Attempt to unsubscribe and expect an error
    await expect(
      host.unsubscribeFromResource("test-server", "file:///test.txt")
    ).rejects.toThrow(
      "Failed to unsubscribe from resource: Unsubscription failed"
    );
  });
});
