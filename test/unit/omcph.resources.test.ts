import { jest } from "@jest/globals";
import {
  McpClientHost,
  McpHostConfig,
  AggregatedResource,
  AggregatedResourceTemplate,
} from "../../src/lib/index.js";

// Setup mocks
const mockConnect = jest.fn().mockImplementation(() => Promise.resolve());
const mockClose = jest.fn().mockImplementation(() => Promise.resolve());

// Mock server capabilities and resources
const mockTools = [];
const mockResources = [
  {
    uri: "resource:test1",
    contentType: "text/plain",
    title: "Test Resource 1",
  },
  {
    uri: "resource:test2",
    contentType: "text/plain",
    title: "Test Resource 2",
  },
];
const mockResourceTemplates = [
  { name: "template1", schema: {}, description: "Test Template 1" },
];
const mockPrompts = [];

// Setup resource list methods
const mockListTools = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ tools: mockTools }));
const mockListResources = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ resources: mockResources }));
const mockListResourceTemplates = jest
  .fn()
  .mockImplementation(() =>
    Promise.resolve({ resourceTemplates: mockResourceTemplates })
  );
const mockListPrompts = jest
  .fn()
  .mockImplementation(() => Promise.resolve({ prompts: mockPrompts }));

// Mock server capabilities
const mockGetServerCapabilities = jest.fn().mockReturnValue({
  resources: {},
});

// Setup the client mock
const mockClient = {
  connect: mockConnect,
  close: mockClose,
  getServerCapabilities: mockGetServerCapabilities,
  listTools: mockListTools,
  listResources: mockListResources,
  listResourceTemplates: mockListResourceTemplates,
  listPrompts: mockListPrompts,
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

describe("McpClientHost Resources", () => {
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

  let host: McpClientHost;

  beforeEach(() => {
    jest.clearAllMocks();
    host = new McpClientHost(sampleConfig);
  });

  afterEach(async () => {
    await host.stop();
  });

  test("getResources returns empty array before start", () => {
    const resources = host.getResources();
    expect(resources).toEqual([]);
  });

  test("getResourceTemplates returns empty array before start", () => {
    const templates = host.getResourceTemplates();
    expect(templates).toEqual([]);
  });

  test("can start and stop host with resources", async () => {
    await host.start();
    await host.stop();
    // Simply test that we can start and stop without errors
  });
});
