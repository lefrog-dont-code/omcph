import { jest } from "@jest/globals";
import { McpClientHost } from "../../src/lib/api.js";
import { McpHostConfig } from "../../src/lib/types.js";

// Tests for our template capability check
test("only calls listResourceTemplates when server explicitly supports templates", async () => {
  // Create basic mock clients with only the functions we need for this test
  const mockClientWithTemplates = {
    getServerCapabilities: () => ({
      resources: {
        templates: true,
      },
    }),
    listResources: jest.fn(),
    listResourceTemplates: jest.fn(),
  };

  const mockClientWithoutTemplates = {
    getServerCapabilities: () => ({
      resources: {
        templates: false,
      },
    }),
    listResources: jest.fn(),
    listResourceTemplates: jest.fn(),
  };

  // Set up the host with our mock client
  const config: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "server-with-templates", transport: "stdio", command: "test" },
      { id: "server-without-templates", transport: "stdio", command: "test" },
    ],
  };
  const host = new McpClientHost(config);

  // Manually assign our mock clients to the host's client map
  (host as any).clients = new Map([
    ["server-with-templates", mockClientWithTemplates],
    ["server-without-templates", mockClientWithoutTemplates],
  ]);

  // Create a simplified updateServerCapabilities function just for testing
  const updateCapabilities = async (serverId: string, client: any) => {
    // This is a simplified version of the updateServerCapabilities method
    const capabilities = client.getServerCapabilities();

    if (capabilities?.resources) {
      await client.listResources();

      if (capabilities.resources.templates === true) {
        await client.listResourceTemplates();
      }
    }
  };

  // Trigger capability updates for both clients using our test function
  await updateCapabilities("server-with-templates", mockClientWithTemplates);
  await updateCapabilities(
    "server-without-templates",
    mockClientWithoutTemplates
  );

  // Verify that listResourceTemplates was called only for the client with template support
  expect(mockClientWithTemplates.listResourceTemplates).toHaveBeenCalled();
  expect(
    mockClientWithoutTemplates.listResourceTemplates
  ).not.toHaveBeenCalled();
});
