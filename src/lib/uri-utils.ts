import { McpClientHostCore } from "./core.js";
import {
  AggregatedResource,
  AggregatedResourceTemplate,
  AggregatedTool,
  AggregatedPrompt,
} from "./types.js";

/**
 * Result of a server suggestion, providing the server ID and confidence level
 */
export interface ServerSuggestion {
  /** The ID of the suggested server */
  serverId: string;
  /** Confidence level of the suggestion (0.0-1.0) */
  confidence: number;
  /** Type of match that was found */
  matchType: "exact" | "template" | "scheme" | "name";
}

/**
 * Utility to help resolve which server(s) can handle a specific resource URI.
 */
export function resolveResourceServer(
  uri: string,
  resources: AggregatedResource[],
  templates: AggregatedResourceTemplate[]
): ServerSuggestion[] {
  const results: ServerSuggestion[] = [];

  // Extract URI scheme (e.g., "file:", "http:")
  const uriScheme = uri.split(":")[0] + ":";

  // Check for exact URI matches (highest priority)
  for (const resource of resources) {
    if (resource.uri === uri) {
      results.push({
        serverId: resource.serverId,
        matchType: "exact",
        confidence: 1.0, // 100% confidence for exact match
      });
    }
  }

  // If we have exact matches, return those immediately (no need to check templates)
  if (results.length > 0) {
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  // Check for template matches
  for (const template of templates) {
    // Simplified template matching: check if URI follows the template pattern
    if (template.uriTemplate && canMatchTemplate(uri, template.uriTemplate)) {
      results.push({
        serverId: template.serverId,
        matchType: "template",
        confidence: 0.8, // 80% confidence for template match
      });
    }
  }

  // If no exact or template matches, check for scheme matches (lowest priority)
  if (results.length === 0) {
    // First collect all unique schemes from resources
    const serversByScheme = new Map<string, Set<string>>();

    for (const resource of resources) {
      const resourceScheme = resource.uri.split(":")[0] + ":";
      if (!serversByScheme.has(resourceScheme)) {
        serversByScheme.set(resourceScheme, new Set());
      }
      serversByScheme.get(resourceScheme)?.add(resource.serverId);
    }

    // Check if our target URI scheme is handled by any server
    if (serversByScheme.has(uriScheme)) {
      const servers = serversByScheme.get(uriScheme) || new Set<string>();
      for (const serverId of servers) {
        results.push({
          serverId,
          matchType: "scheme",
          confidence: 0.5, // 50% confidence for scheme-only match
        });
      }
    }
  }

  // Sort by confidence and return
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Utility to help resolve which server(s) can handle a specific tool.
 */
export function resolveToolServer(
  toolName: string,
  tools: AggregatedTool[]
): ServerSuggestion[] {
  const results: ServerSuggestion[] = [];

  // Check for exact name matches
  for (const tool of tools) {
    if (tool.name === toolName) {
      results.push({
        serverId: tool.serverId,
        matchType: "name",
        confidence: 1.0, // 100% confidence for exact match
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Utility to help resolve which server(s) can handle a specific prompt.
 */
export function resolvePromptServer(
  promptName: string,
  prompts: AggregatedPrompt[]
): ServerSuggestion[] {
  const results: ServerSuggestion[] = [];

  // Check for exact name matches
  for (const prompt of prompts) {
    if (prompt.name === promptName) {
      results.push({
        serverId: prompt.serverId,
        matchType: "name",
        confidence: 1.0, // 100% confidence for exact match
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Helper function to check if a URI can match a template pattern.
 * This is a simplified implementation - you may need to enhance this
 * based on your actual template format and matching logic.
 */
function canMatchTemplate(uri: string, template: string): boolean {
  // Very basic example: Replace {param} placeholders with .* for regex matching
  const regex = new RegExp("^" + template.replace(/\{[^}]+\}/g, ".*") + "$");
  return regex.test(uri);
}
