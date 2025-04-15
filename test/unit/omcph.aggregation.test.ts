import { jest } from "@jest/globals";
import {
  McpClientHost,
  McpHostConfig,
  McpRequestOptions,
} from "../../src/index.js";
import {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js"; // Import base types

// Sample data for tools - include annotations
const server1Tools = {
  tools: [
    {
      id: "tool1",
      name: "Tool 1",
      description: "Tool 1 from server 1",
      annotations: { stability: "stable" },
    },
    { id: "tool2", name: "Tool 2", description: "Tool 2 from server 1" }, // No annotations
  ],
};

const server2Tools = {
  tools: [
    { id: "tool3", name: "Tool 3", description: "Tool 3 from server 2" },
    {
      id: "tool4",
      name: "Tool 4",
      description: "Tool 4 from server 2",
      annotations: { category: "utility" },
    },
  ],
};

// Sample data for resources - include size
const server1Resources = {
  resources: [
    {
      id: "resource1",
      uri: "file://s1/res1",
      name: "Resource 1",
      description: "Resource 1 from server 1",
      size: 1024,
    },
    {
      id: "resource2",
      uri: "file://s1/res2",
      name: "Resource 2",
      description: "Resource 2 from server 1",
    }, // No size
  ],
};

const server2Resources = {
  resources: [
    {
      id: "resource3",
      uri: "file://s2/res3",
      name: "Resource 3",
      description: "Resource 3 from server 2",
    },
    {
      id: "resource4",
      uri: "file://s2/res4",
      name: "Resource 4",
      description: "Resource 4 from server 2",
      size: 2048,
    },
  ],
};

// Sample data for templates
const server1Templates = {
  resourceTemplates: [
    {
      id: "template1",
      name: "Template 1",
      description: "Template 1 from server 1",
      uriTemplate: "file://s1/{id}",
    },
    {
      id: "template2",
      name: "Template 2",
      description: "Template 2 from server 1",
      uriTemplate: "http://s1/{path}",
    },
  ],
};

const server2Templates = {
  resourceTemplates: [
    {
      id: "template3",
      name: "Template 3",
      description: "Template 3 from server 2",
      uriTemplate: "db://s2/{table}",
    },
    {
      id: "template4",
      name: "Template 4",
      description: "Template 4 from server 2",
      uriTemplate: "git://s2/{repo}",
    },
  ],
};

// Sample data for prompts
const server1Prompts = {
  prompts: [
    { id: "prompt1", name: "Prompt 1", description: "Prompt 1 from server 1" },
    { id: "prompt2", name: "Prompt 2", description: "Prompt 2 from server 1" },
  ],
};

const server2Prompts = {
  prompts: [
    { id: "prompt3", name: "Prompt 3", description: "Prompt 3 from server 2" },
    { id: "prompt4", name: "Prompt 4", description: "Prompt 4 from server 2" },
  ],
};

// Create mock clients
const mockClient1 = {
  connect: jest.fn().mockImplementation(() => Promise.resolve()),
  close: jest.fn().mockImplementation(() => Promise.resolve()),
  getServerCapabilities: jest.fn().mockReturnValue({
    tools: { listChanged: true }, // Indicate tool support
    resources: { listChanged: true, templates: true }, // Indicate resource and template support
    prompts: { listChanged: true }, // Indicate prompt support
    completions: {}, // Indicate completions support
  }),
  listTools: jest.fn().mockImplementation(() => Promise.resolve(server1Tools)),
  listResources: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server1Resources)),
  listResourceTemplates: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server1Templates)),
  listPrompts: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server1Prompts)),
  // Add other methods if needed by tests
  sendRootsListChanged: jest.fn().mockReturnValue(Promise.resolve()),
  setRequestHandler: jest.fn(),
  setNotificationHandler: jest.fn(),
  onclose: jest.fn(),
  onerror: jest.fn(),
};

const mockClient2 = {
  connect: jest.fn().mockImplementation(() => Promise.resolve()),
  close: jest.fn().mockImplementation(() => Promise.resolve()),
  getServerCapabilities: jest.fn().mockReturnValue({
    tools: { listChanged: true },
    resources: { listChanged: true, templates: true },
    prompts: { listChanged: true },
    logging: {}, // Indicate logging support
  }),
  listTools: jest.fn().mockImplementation(() => Promise.resolve(server2Tools)),
  listResources: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server2Resources)),
  listResourceTemplates: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server2Templates)),
  listPrompts: jest
    .fn()
    .mockImplementation(() => Promise.resolve(server2Prompts)),
  // Add other methods if needed by tests
  sendRootsListChanged: jest.fn().mockReturnValue(Promise.resolve()),
  setRequestHandler: jest.fn(),
  setNotificationHandler: jest.fn(),
  onclose: jest.fn(),
  onerror: jest.fn(),
};

// Mock the SDK modules
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: jest.fn().mockImplementation(() => {
    // Will be explicitly assigned in the test
    return mockClient1;
  }),
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

// Helper function to add clients directly to the host and trigger capability aggregation
async function addClientsToHost(host: McpClientHost) {
  const clientsMap = (host as any).clients;
  clientsMap.set("server1", mockClient1);
  clientsMap.set("server2", mockClient2);

  // Manually trigger capability updates
  await (host as any).updateServerCapabilities("server1", mockClient1);
  await (host as any).updateServerCapabilities("server2", mockClient2);
}

describe("McpClientHost Capability Aggregation (MCP 2025-03-26)", () => {
  let host: McpClientHost;

  beforeEach(() => {
    jest.clearAllMocks();
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [
        { id: "server1", transport: "stdio", command: "server1-command" },
        { id: "server2", transport: "stdio", command: "server2-command" },
      ],
    };
    host = new McpClientHost(config);
  });

  afterEach(async () => {
    await host.stop();
  });

  test("aggregates tools including annotations", async () => {
    await addClientsToHost(host);
    const aggTools = host.getTools(); // Use public API

    expect(aggTools.length).toBe(4);
    // Check tool1 with annotations
    expect(aggTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: "server1",
          name: "Tool 1",
          annotations: { stability: "stable" },
        }),
      ])
    );
    // Check tool2 without annotations (should be undefined or not present)
    const tool2 = aggTools.find(
      (t) => t.serverId === "server1" && t.name === "Tool 2"
    );
    expect(tool2).toBeDefined();
    // Testing for absence of a property
    expect("annotations" in (tool2 || {})).toBe(false);
    // Check tool4 with annotations
    expect(aggTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: "server2",
          name: "Tool 4",
          annotations: { category: "utility" },
        }),
      ])
    );
  });

  test("aggregates resources including size", async () => {
    await addClientsToHost(host);
    const aggResources = host.getResources(); // Use public API

    expect(aggResources.length).toBe(4);
    // Check resource1 with size
    expect(aggResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: "server1",
          name: "Resource 1",
          size: 1024,
        }),
      ])
    );
    // Check resource2 without size
    const resource2 = aggResources.find(
      (r) => r.serverId === "server1" && r.name === "Resource 2"
    );
    expect(resource2).toBeDefined();
    // Testing for absence of a property
    expect("size" in (resource2 || {})).toBe(false);
    // Check resource4 with size
    expect(aggResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: "server2",
          name: "Resource 4",
          size: 2048,
        }),
      ])
    );
  });

  test("aggregates resource templates correctly", async () => {
    await addClientsToHost(host);
    const aggTemplates = host.getResourceTemplates(); // Use public API

    expect(aggTemplates.length).toBe(4);
    expect(aggTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: "server1", id: "template1" }),
        expect.objectContaining({ serverId: "server1", id: "template2" }),
        expect.objectContaining({ serverId: "server2", id: "template3" }),
        expect.objectContaining({ serverId: "server2", id: "template4" }),
      ])
    );
    // Check a specific template detail
    const template3 = aggTemplates.find(
      (t) => t.serverId === "server2" && t.id === "template3"
    );
    expect(template3?.uriTemplate).toBe("db://s2/{table}");
  });

  test("aggregates prompts correctly", async () => {
    await addClientsToHost(host);
    const aggPrompts = host.getPrompts(); // Use public API

    expect(aggPrompts.length).toBe(4);
    expect(aggPrompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: "server1", name: "Prompt 1" }),
        expect.objectContaining({ serverId: "server1", name: "Prompt 2" }),
        expect.objectContaining({ serverId: "server2", name: "Prompt 3" }),
        expect.objectContaining({ serverId: "server2", name: "Prompt 4" }),
      ])
    );
  });

  test("handles server disconnection and removes its capabilities", async () => {
    await addClientsToHost(host);

    // Verify initial aggregation counts
    expect(host.getTools().length).toBe(4);
    expect(host.getResources().length).toBe(4);
    expect(host.getResourceTemplates().length).toBe(4);
    expect(host.getPrompts().length).toBe(4);

    // Simulate server1 disconnection
    (host as any).handleServerDisconnection("server1");

    // Verify capabilities from server1 are removed
    expect(host.getTools().length).toBe(2);
    expect(host.getResources().length).toBe(2);
    expect(host.getResourceTemplates().length).toBe(2);
    expect(host.getPrompts().length).toBe(2);

    // Verify remaining capabilities are from server2
    expect(host.getTools().every((t) => t.serverId === "server2")).toBe(true);
    expect(host.getResources().every((r) => r.serverId === "server2")).toBe(
      true
    );
    expect(
      host.getResourceTemplates().every((t) => t.serverId === "server2")
    ).toBe(true);
    expect(host.getPrompts().every((p) => p.serverId === "server2")).toBe(true);
  });

  test("correctly recognizes and reports server capabilities", async () => {
    await addClientsToHost(host);

    // Access the aggregated server capabilities through internal property
    const serverCapabilities = (host as any).serverCapabilities;

    // Check server1 has completions capability
    const server1Caps = serverCapabilities.get("server1");
    expect(server1Caps).toBeDefined();
    expect(server1Caps.completions).toBeDefined();

    // Check server2 has logging capability
    const server2Caps = serverCapabilities.get("server2");
    expect(server2Caps).toBeDefined();
    expect(server2Caps.logging).toBeDefined();
  });

  test("emits capabilitiesUpdated event when capabilities change", async () => {
    const updateSpy = jest.spyOn(host, "emit");

    await addClientsToHost(host);
    // Should be called at least once per server during addClientsToHost
    expect(updateSpy).toHaveBeenCalledWith("capabilitiesUpdated");
    updateSpy.mockClear(); // Reset spy

    // Simulate server disconnection
    (host as any).handleServerDisconnection("server1");
    expect(updateSpy).toHaveBeenCalledWith("capabilitiesUpdated");

    updateSpy.mockRestore();
  });

  test("handles server notification for capability list changes", async () => {
    const updateSpy = jest.spyOn(host, "emit");
    await addClientsToHost(host);
    updateSpy.mockClear(); // Clear initial calls

    // Simulate server1 sending a tool list changed notification
    // This requires mocking the notification handler setup in connectToServer
    // For simplicity, we'll directly call updateServerCapabilities again
    const updatedServer1Tools = {
      tools: [
        {
          id: "tool1",
          name: "Tool 1 Updated",
          description: "Updated Tool 1",
          annotations: { version: "1.1" },
        },
        // Tool 2 removed
        { id: "tool5", name: "Tool 5 New", description: "New Tool 5" },
      ],
    };
    mockClient1.listTools.mockImplementation(() =>
      Promise.resolve(updatedServer1Tools)
    );

    await (host as any).updateServerCapabilities("server1", mockClient1);

    // Check event emitted
    expect(updateSpy).toHaveBeenCalledWith("capabilitiesUpdated");

    // Check updated tools
    const aggTools = host.getTools();
    expect(aggTools.length).toBe(4); // 2 from server2 + 2 updated from server1
    expect(aggTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverId: "server1",
          name: "Tool 1 Updated",
          annotations: { version: "1.1" },
        }),
        expect.objectContaining({ serverId: "server1", name: "Tool 5 New" }),
        expect.objectContaining({ serverId: "server2", name: "Tool 3" }),
        expect.objectContaining({ serverId: "server2", name: "Tool 4" }),
      ])
    );
    // Ensure tool2 is gone
    expect(
      aggTools.find((t) => t.serverId === "server1" && t.name === "Tool 2")
    ).toBeUndefined();

    updateSpy.mockRestore();
  });
});
