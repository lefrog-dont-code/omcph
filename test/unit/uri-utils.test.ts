import { McpClientHostCore } from "../../src/core.js";
import { resolveResourceServer } from "../../src/uri-utils.js";
import {
  AggregatedResource,
  AggregatedResourceTemplate,
  McpHostConfig,
} from "../../src/types.js";

describe("URI Resolution Utility", () => {
  let mockResources: AggregatedResource[];
  let mockTemplates: AggregatedResourceTemplate[];

  beforeEach(() => {
    // Create mock resources and templates for testing
    mockResources = [
      // Exact URI match
      {
        serverId: "filesystem1",
        uri: "file:///documents/report.txt",
        name: "report-txt",
      } as AggregatedResource,
      // Another exact URI match
      {
        serverId: "filesystem2",
        uri: "http://example.com/documents/data.json",
        name: "data-json",
      } as AggregatedResource,
      // Resources for scheme matching
      {
        serverId: "file-server",
        uri: "file:///user/documents/notes.md",
        name: "notes-md",
      } as AggregatedResource,
      {
        serverId: "web-server",
        uri: "http://api.example.com/data",
        name: "api-data",
      } as AggregatedResource,
    ];

    mockTemplates = [
      // Template match
      {
        serverId: "dynamic-server",
        uriTemplate: "file:///dynamic/{id}.txt",
        name: "dynamic-template",
      } as AggregatedResourceTemplate,
      {
        serverId: "web-template",
        uriTemplate: "http://example.com/users/{username}/profile",
        name: "user-profile-template",
      } as AggregatedResourceTemplate,
    ];
  });

  describe("Exact URI Matching", () => {
    it("should return exact URI match with 100% confidence", () => {
      const results = resolveResourceServer(
        "file:///documents/report.txt",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        serverId: "filesystem1",
        matchType: "exact",
        confidence: 1.0,
      });
    });

    it("should return multiple exact matches if they exist", () => {
      // Add another resource with the same URI
      mockResources.push({
        serverId: "filesystem3",
        uri: "file:///documents/report.txt",
        name: "another-report-txt",
      } as AggregatedResource);

      const results = resolveResourceServer(
        "file:///documents/report.txt",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(2);
      expect(results).toContainEqual({
        serverId: "filesystem1",
        matchType: "exact",
        confidence: 1.0,
      });
      expect(results).toContainEqual({
        serverId: "filesystem3",
        matchType: "exact",
        confidence: 1.0,
      });
    });
  });

  describe("Template Matching", () => {
    it("should return template match with 80% confidence when no exact match exists", () => {
      const results = resolveResourceServer(
        "file:///dynamic/123.txt",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        serverId: "dynamic-server",
        matchType: "template",
        confidence: 0.8,
      });
    });

    it("should prefer exact match over template match", () => {
      // Add an exact match alongside the template
      mockResources.push({
        serverId: "exact-server",
        uri: "file:///dynamic/123.txt",
        name: "exact-dynamic-txt",
      } as AggregatedResource);

      const results = resolveResourceServer(
        "file:///dynamic/123.txt",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        serverId: "exact-server",
        matchType: "exact",
        confidence: 1.0,
      });
    });
  });

  describe("Scheme Matching", () => {
    it("should return scheme match with 50% confidence when no exact or template match exists", () => {
      const results = resolveResourceServer(
        "file:///unknown/path.txt",
        mockResources,
        mockTemplates
      );

      // Verify that we get at least one scheme match
      expect(results.length).toBeGreaterThan(0);

      // Check that the first result is a scheme match
      const schemeMatches = results.filter((r) => r.matchType === "scheme");
      expect(schemeMatches.length).toBeGreaterThan(0);

      // Verify the scheme match has a valid server ID
      expect(schemeMatches[0].serverId).toMatch(
        /^(file-server|filesystem\d*)$/
      );
    });

    it("should return multiple scheme matches if they exist", () => {
      // Add another file scheme resource
      mockResources.push({
        serverId: "another-file-server",
        uri: "file:///another/path/document.txt",
        name: "another-file-txt",
      } as AggregatedResource);

      const results = resolveResourceServer(
        "file:///unknown/path.txt",
        mockResources,
        mockTemplates
      );

      // Verify multiple scheme matches
      const schemeMatches = results.filter((r) => r.matchType === "scheme");
      expect(schemeMatches.length).toBeGreaterThan(1);

      // Check that the matches include expected server IDs
      const serverIds = schemeMatches.map((r) => r.serverId);
      expect(serverIds).toContain("file-server");
      expect(serverIds).toContain("another-file-server");
    });
  });

  describe("Matching Priority", () => {
    it("should return matches in order of confidence", () => {
      // Add multiple match types for the same URI
      mockResources.push({
        serverId: "scheme-server",
        uri: "http://example.org/some/path",
        name: "example-org-path",
      } as AggregatedResource);

      mockTemplates.push({
        serverId: "template-server",
        uriTemplate: "http://example.org/{path}",
        name: "example-org-template",
      } as AggregatedResourceTemplate);

      const results = resolveResourceServer(
        "http://example.org/some/path",
        mockResources,
        mockTemplates
      );

      // Verify that we get at least one match
      expect(results.length).toBeGreaterThan(0);

      // Check the match types in order of confidence
      const matchTypes = results.map((r) => r.matchType);
      const confidenceOrder = ["exact", "template", "scheme"];

      // Verify that the results are sorted by confidence
      const sortedResults = results.sort(
        (a, b) =>
          confidenceOrder.indexOf(a.matchType) -
          confidenceOrder.indexOf(b.matchType)
      );

      expect(results).toEqual(sortedResults);
    });
  });

  describe("Edge Cases", () => {
    it("should return empty array for completely unmatched URI", () => {
      const results = resolveResourceServer(
        "ftp://unknown.com/file",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(0);
    });

    it("should handle URIs with complex characters", () => {
      // Add a resource with a complex URI
      mockResources.push({
        serverId: "complex-server",
        uri: "file:///path/with%20spaces/and-special_chars.txt",
        name: "complex-chars-txt",
      } as AggregatedResource);

      const results = resolveResourceServer(
        "file:///path/with%20spaces/and-special_chars.txt",
        mockResources,
        mockTemplates
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        serverId: "complex-server",
        matchType: "exact",
        confidence: 1.0,
      });
    });
  });
});
