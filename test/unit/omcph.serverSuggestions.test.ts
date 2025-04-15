import { jest } from "@jest/globals";
import { McpClientHost } from "../../src/api.js";
import {
  McpHostConfig,
  AggregatedResource,
  AggregatedResourceTemplate,
  AggregatedTool,
  AggregatedPrompt,
  Tool,
} from "../../src/types.js";
import { ServerSuggestion } from "../../src/uri-utils.js";

describe("McpClientHost - Server Suggestion Methods", () => {
  let host: McpClientHost;
  let mockResources: AggregatedResource[];
  let mockTemplates: AggregatedResourceTemplate[];
  let mockTools: AggregatedTool[];
  let mockPrompts: AggregatedPrompt[];

  beforeEach(() => {
    // Create a basic host config
    const config: McpHostConfig = {
      hostInfo: { name: "TestHost", version: "1.0.0" },
      servers: [],
    };

    host = new McpClientHost(config);

    // Set up test data
    mockResources = [
      {
        serverId: "fs-server",
        uri: "file:///documents/report.txt",
        name: "Report TXT",
        description: "Text report document",
        mimeType: "text/plain",
      } as AggregatedResource,
      {
        serverId: "web-server",
        uri: "http://example.com/data.json",
        name: "Data JSON",
        description: "JSON data from example.com",
        mimeType: "application/json",
      } as AggregatedResource,
    ];

    mockTemplates = [
      {
        serverId: "fs-server",
        id: "file-template",
        name: "File Template",
        description: "Template for accessing files",
        uriTemplate: "file:///{path}",
      } as AggregatedResourceTemplate,
      {
        serverId: "web-server",
        id: "api-template",
        name: "API Template",
        description: "Template for API endpoints",
        uriTemplate: "http://api.example.com/{endpoint}",
      } as AggregatedResourceTemplate,
    ];

    mockTools = [
      {
        serverId: "tool-server-1",
        name: "readFile",
        description: "Read a file from the filesystem",
        id: "tool1",
        inputSchema: { type: "object", properties: {} },
      } as Tool & { serverId: string },
      {
        serverId: "tool-server-2",
        name: "analyzeImage",
        description: "Analyze an image",
        id: "tool2",
        inputSchema: { type: "object", properties: {} },
      } as Tool & { serverId: string },
    ];

    mockPrompts = [
      {
        serverId: "prompt-server-1",
        name: "summarize",
        description: "Summarize text",
        id: "prompt1",
      } as AggregatedPrompt,
      {
        serverId: "prompt-server-2",
        name: "translate",
        description: "Translate text",
        id: "prompt2",
      } as AggregatedPrompt,
    ];

    // Mock the aggregated data in the host
    (host as any).aggregatedResources = new Map(
      mockResources.map((r) => [`${r.serverId}/${r.uri}`, r])
    );
    (host as any).aggregatedResourceTemplates = new Map(
      mockTemplates.map((t) => [`${t.serverId}/${t.id}`, t])
    );
    (host as any).aggregatedTools = new Map(
      mockTools.map((t) => [`${t.serverId}/${t.name}`, t])
    );
    (host as any).aggregatedPrompts = new Map(
      mockPrompts.map((p) => [`${p.serverId}/${p.name}`, p])
    );
  });

  describe("suggestServerForUri", () => {
    it("should find exact URI matches with highest confidence", () => {
      const suggestions = host.suggestServerForUri(
        "file:///documents/report.txt"
      );

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        serverId: "fs-server",
        matchType: "exact",
        confidence: 1.0,
      });
    });

    it("should find template matches when no exact match exists", () => {
      const suggestions = host.suggestServerForUri(
        "file:///some/other/path.txt"
      );

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        serverId: "fs-server",
        matchType: "template",
        confidence: 0.8,
      });
    });

    it("should fall back to scheme matches when no exact or template match exists", () => {
      const suggestions = host.suggestServerForUri(
        "http://unknown.example.org/data"
      );

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].matchType).toBe("scheme");
      expect(suggestions[0].serverId).toBe("web-server");
      expect(suggestions[0].confidence).toBe(0.5);
    });

    it("should return empty array for completely unmatched URI schemes", () => {
      const suggestions = host.suggestServerForUri(
        "ftp://example.com/file.txt"
      );

      expect(suggestions).toHaveLength(0);
    });
  });

  describe("suggestServerForTool", () => {
    it("should find exact tool name matches", () => {
      const suggestions = host.suggestServerForTool("readFile");

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        serverId: "tool-server-1",
        matchType: "name",
        confidence: 1.0,
      });
    });

    it("should return empty array for unmatched tool names", () => {
      const suggestions = host.suggestServerForTool("nonExistentTool");

      expect(suggestions).toHaveLength(0);
    });
  });

  describe("suggestServerForPrompt", () => {
    it("should find exact prompt name matches", () => {
      const suggestions = host.suggestServerForPrompt("summarize");

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual({
        serverId: "prompt-server-1",
        matchType: "name",
        confidence: 1.0,
      });
    });

    it("should return empty array for unmatched prompt names", () => {
      const suggestions = host.suggestServerForPrompt("nonExistentPrompt");

      expect(suggestions).toHaveLength(0);
    });
  });
});
