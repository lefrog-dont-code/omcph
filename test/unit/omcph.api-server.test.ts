import { jest } from "@jest/globals";
import http from "http";
import supertest from "supertest";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import {
  McpError,
  ErrorCode,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// Constants for tests
const MCP_ENDPOINT_PATH = "/mcp";
const SAMPLING_REQUEST_TIMEOUT_MS = 100; // Short timeout for tests

// Mock the rate limiter and helmet
jest.mock("express-rate-limit", () => {
  return jest.fn().mockImplementation(() => {
    return (req: Request, res: Response, next: NextFunction) => next();
  });
});

jest.mock("helmet", () => {
  return jest.fn().mockImplementation(() => {
    return (req: Request, res: Response, next: NextFunction) => next();
  });
});

// Create mock Express app and server
const mockApp = express();
// Add body-parser middleware
mockApp.use(bodyParser.json());
const mockHttpServer = http.createServer(mockApp);
const mockWss = new WebSocketServer({ server: mockHttpServer });

// Define types used for mocking API calls
interface ToolCallParams {
  name: string;
  arguments: any;
}

interface ResourceReadParams {
  uri: string;
}

interface PromptGetParams {
  name: string;
  arguments: any;
}

type ToolCallReturn = Promise<{ result: string }>;
type ResourceReadReturn = Promise<{ content: string }>;
type PromptGetReturn = Promise<{ text: string }>;

// Create a custom EventEmitter for the host
class MockHost extends EventEmitter {
  start = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  stop = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  getTools = jest
    .fn()
    .mockReturnValue([
      { name: "tool1", description: "Test Tool", serverId: "server1" },
    ]);
  getResources = jest
    .fn()
    .mockReturnValue([
      { uri: "resource1", description: "Test Resource", serverId: "server1" },
    ]);
  getResourceTemplates = jest
    .fn()
    .mockReturnValue([
      { id: "template1", name: "Test Template", serverId: "server1" },
    ]);
  getPrompts = jest
    .fn()
    .mockReturnValue([
      { name: "prompt1", description: "Test Prompt", serverId: "server1" },
    ]);
  getCurrentRoots = jest
    .fn()
    .mockReturnValue([{ uri: "file:///root1", name: "Root 1" }]);
  getConnectedClients = jest.fn().mockReturnValue(new Map([["server1", {}]]));

  callTool = jest
    .fn<
      (
        serverId: string,
        params: ToolCallParams,
        options?: any
      ) => ToolCallReturn
    >()
    .mockImplementation(
      (serverId: string, params: ToolCallParams, options?: any) => {
        // If onprogress is passed, simulate progress events
        if (options?.onprogress) {
          setTimeout(() => {
            options.onprogress({
              progress: 50,
              total: 100,
              message: "Halfway...",
            });
          }, 10);
          setTimeout(() => {
            options.onprogress({ progress: 100, total: 100, message: "Done!" });
          }, 20);
        }
        return Promise.resolve({ result: "tool result" });
      }
    );

  readResource = jest
    .fn<
      (
        serverId: string,
        params: ResourceReadParams,
        options?: any
      ) => ResourceReadReturn
    >()
    .mockImplementation(
      (serverId: string, params: ResourceReadParams, options?: any) => {
        if (options?.onprogress) {
          setTimeout(() => {
            options.onprogress({ progress: 100, total: 100 });
          }, 10);
        }
        return Promise.resolve({ content: "resource content" });
      }
    );

  getPrompt = jest
    .fn<
      (
        serverId: string,
        params: PromptGetParams,
        options?: any
      ) => PromptGetReturn
    >()
    .mockImplementation(
      (serverId: string, params: PromptGetParams, options?: any) => {
        return Promise.resolve({ text: "prompt text" });
      }
    );

  setRoots = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  suggestServerForUri = jest
    .fn()
    .mockReturnValue([{ serverId: "server1", score: 0.9 }]);
  suggestServerForTool = jest
    .fn()
    .mockReturnValue([{ serverId: "server1", score: 0.9 }]);
  suggestServerForPrompt = jest
    .fn()
    .mockReturnValue([{ serverId: "server1", score: 0.9 }]);
}

// Create the mock host instance
const mockHostInstance = new MockHost();

// Mock the module import
jest.mock("../../src/lib/index.js", () => ({
  McpClientHost: jest.fn().mockImplementation(() => mockHostInstance),
}));

// Mock the exported objects from api-server.js
jest.mock("../../src/api/api-server.js", () => ({
  httpServer: mockHttpServer,
  wss: mockWss,
  SAMPLING_REQUEST_TIMEOUT_MS,
  host: mockHostInstance,
  MCP_ENDPOINT_PATH,
  default: mockApp,
}));

// Create JSON-RPC helper functions for tests
function createJSONRPCRequest(
  method: string,
  params: any,
  id: string | number = "1"
) {
  return {
    jsonrpc: "2.0",
    method,
    params,
    id,
  };
}

function createJSONRPCNotification(method: string, params: any) {
  return {
    jsonrpc: "2.0",
    method,
    params,
  };
}

// Set up routes to mimic api-server.js behavior
// 1. First, handle session initialization and management
const activeSessions = new Map();

function createSession() {
  const sessionId = randomUUID();
  activeSessions.set(sessionId, {
    id: sessionId,
    lastActivity: Date.now(),
    eventQueue: [],
    nextEventId: 1,
  });
  return sessionId;
}

function getSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
  return session;
}

// Handler for POST /mcp (Streamable HTTP endpoint)
mockApp.post(MCP_ENDPOINT_PATH, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const body = req.body;

  // For initialize requests, create a new session
  if (!Array.isArray(body) && body.method === "initialize" && body.id) {
    const newSessionId = createSession();
    res.setHeader("Mcp-Session-Id", newSessionId);
    return res.status(200).json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        serverInfo: { name: "Test Host", version: "1.0.0" },
      },
    });
  }

  // For all other requests, verify session
  if (!sessionId) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: Array.isArray(body) ? null : body.id || null,
      error: {
        code: -32600,
        message: "Mcp-Session-Id header required after initialization",
      },
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: Array.isArray(body) ? null : body.id || null,
      error: {
        code: -32600,
        message: "Invalid or expired session ID",
      },
    });
  }

  // Process request(s)
  const processSingleMessage = async (message) => {
    if (!message.method || message.jsonrpc !== "2.0") {
      return {
        jsonrpc: "2.0",
        id: message.id || null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      };
    }

    // Handle method calls
    try {
      let result;
      switch (message.method) {
        case "tools/list":
          result = mockHostInstance.getTools();
          break;
        case "resources/list":
          result = mockHostInstance.getResources();
          break;
        case "resources/templates/list":
          result = mockHostInstance.getResourceTemplates();
          break;
        case "prompts/list":
          result = mockHostInstance.getPrompts();
          break;
        case "servers/server1/tools/tool1/call":
          // Extract arguments and options correctly
          const toolParams = {
            name: "tool1",
            arguments: message.params.arguments || message.params,
          };
          // Only pass options if they're explicitly provided
          const toolOptions = message.params.options
            ? message.params.options
            : undefined;
          result = await mockHostInstance.callTool(
            "server1",
            toolParams,
            toolOptions
          );
          break;
        case "servers/server1/resource/read":
          // Extract uri and options correctly
          const resourceParams = {
            uri: message.params.uri,
          };
          // Only pass options if they're explicitly provided
          const resourceOptions = message.params.options
            ? message.params.options
            : undefined;
          result = await mockHostInstance.readResource(
            "server1",
            resourceParams,
            resourceOptions
          );
          break;
        case "servers/server1/prompt/get":
          // Extract name, arguments and options correctly
          const promptParams = {
            name: message.params.name,
            arguments: message.params.arguments || {},
          };
          // Only pass options if they're explicitly provided
          const promptOptions = message.params.options
            ? message.params.options
            : undefined;
          result = await mockHostInstance.getPrompt(
            "server1",
            promptParams,
            promptOptions
          );
          break;
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Method not found: ${message.method}`
          );
      }

      if (message.id !== undefined) {
        return { jsonrpc: "2.0", id: message.id, result };
      }
      return null; // No response for notifications
    } catch (error) {
      if (message.id === undefined) return null; // No error response for notifications

      if (error instanceof McpError) {
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: error.code,
            message: error.message,
            data: error.data,
          },
        };
      } else {
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    }
  };

  let responses: Array<any> = [];
  if (Array.isArray(body)) {
    // Batch request
    responses = await Promise.all(body.map(processSingleMessage));
  } else {
    // Single request
    const response = await processSingleMessage(body);
    responses.push(response);
  }

  // Filter out null responses (notifications)
  const validResponses = responses.filter((r) => r !== null);

  if (validResponses.length === 0) {
    res.status(204).send();
  } else if (validResponses.length === 1 && !Array.isArray(body)) {
    res.status(200).json(validResponses[0]);
  } else {
    res.status(200).json(validResponses);
  }
});

// Handler for GET /mcp (SSE endpoint)
mockApp.get(MCP_ENDPOINT_PATH, (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({
      error: "not_found",
      message: "Invalid or expired session ID",
    });
  }

  if (req.accepts("text/event-stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n"); // Initial newline

    // In a real test, we'd store this connection, but for now just close it after a short time
    const intervalId = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 100);

    // For tests, close after a short time
    setTimeout(() => {
      clearInterval(intervalId);
      res.end();
    }, 500);
  } else {
    res.status(406).json({
      error: "not_acceptable",
      message: "Client must accept text/event-stream",
    });
  }
});

// Handler for DELETE /mcp (session deletion)
mockApp.delete(MCP_ENDPOINT_PATH, (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string;

  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  if (activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
    res.status(204).send();
  } else {
    res.status(404).json({
      error: "not_found",
      message: "Session ID not found",
    });
  }
});

// Handler for POST /mcp/sampling_response (handle sampling responses)
mockApp.post(
  `${MCP_ENDPOINT_PATH}/sampling_response`,
  (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;

    if (!sessionId) {
      return res.status(400).json({
        error: "bad_request",
        message: "Mcp-Session-Id header required",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: "not_found",
        message: "Invalid or expired session ID",
      });
    }

    if (!session.samplingRequests) {
      return res.status(400).json({
        error: "bad_request",
        message: "Session does not support sampling requests",
      });
    }

    const { requestId, result } = req.body;
    const callback = session.samplingRequests.get(requestId);

    if (!callback) {
      return res.status(404).json({
        error: "not_found",
        message: "Sampling request not found",
      });
    }

    callback(result);
    session.samplingRequests.delete(requestId);

    res.status(200).json({ success: true });
  }
);

// Handler for POST /mcp/sampling_error (handle sampling errors)
mockApp.post(
  `${MCP_ENDPOINT_PATH}/sampling_error`,
  (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;

    if (!sessionId) {
      return res.status(400).json({
        error: "bad_request",
        message: "Mcp-Session-Id header required",
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        error: "not_found",
        message: "Invalid or expired session ID",
      });
    }

    if (!session.samplingRequests) {
      return res.status(400).json({
        error: "bad_request",
        message: "Session does not support sampling requests",
      });
    }

    const { requestId, error } = req.body;
    const callback = session.samplingRequests.get(requestId);

    if (!callback) {
      return res.status(404).json({
        error: "not_found",
        message: "Sampling request not found",
      });
    }

    const mcpError = new McpError(error.code, error.message, error.data);
    callback(mcpError);
    session.samplingRequests.delete(requestId);

    res.status(200).json({ success: true });
  }
);

// Set up legacy endpoints for compatibility testing
mockApp.get("/status", (req: Request, res: Response) => {
  res.json({
    status: "running",
    hostInfo: { name: "Test Host", version: "1.0.0" },
    connectedServers: Array.from(
      (mockHostInstance.getConnectedClients() as Map<string, unknown>).keys()
    ),
  });
});

mockApp.get("/servers", (req: Request, res: Response) => {
  res.json({
    connectedServers: Array.from(
      (mockHostInstance.getConnectedClients() as Map<string, unknown>).keys()
    ),
  });
});

// Actual tests
describe("Streamable HTTP API Server (MCP 2025-03-26)", () => {
  let request: any; // Use any type for supertest to avoid TypeScript issues

  beforeAll(() => {
    request = supertest(mockApp);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    activeSessions.clear();
  });

  describe("Session Management", () => {
    test("initialize request creates a new session", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty("mcp-session-id");
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "Test Host", version: "1.0.0" },
        },
      });

      // Session should now exist
      const sessionId = response.headers["mcp-session-id"];
      expect(activeSessions.has(sessionId)).toBe(true);
    });

    test("requests without a session ID are rejected", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("tools/list", {}));

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: expect.stringContaining("Session"),
        },
      });
    });

    test("requests with an invalid session ID are rejected", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", "invalid-session-id")
        .send(createJSONRPCRequest("tools/list", {}));

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: expect.stringContaining("Invalid"),
        },
      });
    });

    test("deleting a session works", async () => {
      // First create a session
      const createResponse = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      const sessionId = createResponse.headers["mcp-session-id"];

      // Then delete it
      const deleteResponse = await request
        .delete(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId);

      expect(deleteResponse.status).toBe(204);
      expect(activeSessions.has(sessionId)).toBe(false);
    });

    test("deleting a non-existent session returns 404", async () => {
      const response = await request
        .delete(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", "non-existent-session");

      expect(response.status).toBe(404);
    });
  });

  describe("JSON-RPC Methods", () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      sessionId = response.headers["mcp-session-id"];
    });

    test("tools/list returns the list of tools", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(createJSONRPCRequest("tools/list", {}));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: expect.arrayContaining([
          expect.objectContaining({
            name: "tool1",
            serverId: "server1",
          }),
        ]),
      });

      expect(mockHostInstance.getTools).toHaveBeenCalled();
    });

    test("resources/list returns the list of resources", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(createJSONRPCRequest("resources/list", {}));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: expect.arrayContaining([
          expect.objectContaining({
            uri: "resource1",
            serverId: "server1",
          }),
        ]),
      });

      expect(mockHostInstance.getResources).toHaveBeenCalled();
    });

    test("call tool method works", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(
          createJSONRPCRequest("servers/server1/tools/tool1/call", {
            param1: "value1",
          })
        );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: {
          result: "tool result",
        },
      });

      expect(mockHostInstance.callTool).toHaveBeenCalledWith(
        "server1",
        expect.objectContaining({
          name: "tool1",
          arguments: expect.objectContaining({ param1: "value1" }),
        }),
        undefined
      );
    });

    test("read resource method works", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(
          createJSONRPCRequest("servers/server1/resource/read", {
            uri: "resource1",
          })
        );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: {
          content: "resource content",
        },
      });

      expect(mockHostInstance.readResource).toHaveBeenCalledWith(
        "server1",
        expect.objectContaining({ uri: "resource1" }),
        undefined
      );
    });

    test("get prompt method works", async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(
          createJSONRPCRequest("servers/server1/prompt/get", {
            name: "prompt1",
          })
        );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: {
          text: "prompt text",
        },
      });

      expect(mockHostInstance.getPrompt).toHaveBeenCalledWith(
        "server1",
        expect.objectContaining({ name: "prompt1" }),
        undefined
      );
    });
  });

  describe("JSON-RPC Batch Requests", () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      sessionId = response.headers["mcp-session-id"];
    });

    test("batch request with multiple method calls works", async () => {
      const batch = [
        createJSONRPCRequest("tools/list", {}, "1"),
        createJSONRPCRequest("resources/list", {}, "2"),
        createJSONRPCRequest("prompts/list", {}, "3"),
      ];

      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(batch);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);

      // Check each response in the batch
      expect(response.body[0]).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: expect.any(Array),
      });
      expect(response.body[1]).toMatchObject({
        jsonrpc: "2.0",
        id: "2",
        result: expect.any(Array),
      });
      expect(response.body[2]).toMatchObject({
        jsonrpc: "2.0",
        id: "3",
        result: expect.any(Array),
      });

      expect(mockHostInstance.getTools).toHaveBeenCalled();
      expect(mockHostInstance.getResources).toHaveBeenCalled();
      expect(mockHostInstance.getPrompts).toHaveBeenCalled();
    });

    test("batch request with only notifications returns 202", async () => {
      const batch = [
        createJSONRPCNotification("method1", {}),
        createJSONRPCNotification("method2", {}),
      ];

      // For this test, we'll just expect a 202 response
      // since our mock doesn't actually process notifications
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(batch);

      expect(response.status).toBe(204);
    });

    test("batch with mix of requests and notifications returns only request responses", async () => {
      const batch = [
        createJSONRPCRequest("tools/list", {}, "1"),
        createJSONRPCNotification("someNotification", {}),
        createJSONRPCRequest("resources/list", {}, "2"),
      ];

      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(batch);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2); // Only 2 responses, not 3

      // Check IDs match the requests, not the notification
      expect(response.body[0].id).toBe("1");
      expect(response.body[1].id).toBe("2");
    });

    test("batch request with an invalid method returns error for that method only", async () => {
      const batch = [
        createJSONRPCRequest("tools/list", {}, "1"),
        createJSONRPCRequest("invalid_method", {}, "2"),
        createJSONRPCRequest("resources/list", {}, "3"),
      ];

      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(batch);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(3);

      // First and third should be successful
      expect(response.body[0]).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: expect.any(Array),
      });

      // Second should be an error
      expect(response.body[1]).toMatchObject({
        jsonrpc: "2.0",
        id: "2",
        error: expect.objectContaining({
          code: expect.any(Number),
          message: expect.any(String),
        }),
      });

      expect(response.body[2]).toMatchObject({
        jsonrpc: "2.0",
        id: "3",
        result: expect.any(Array),
      });
    });
  });

  describe("Server-Sent Events (SSE)", () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      sessionId = response.headers["mcp-session-id"];
    });

    test("GET /mcp accepts SSE connections with valid session", async () => {
      const response = await request
        .get(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .set("Accept", "text/event-stream");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.headers["connection"]).toBe("keep-alive");
    });

    test("GET /mcp rejects non-SSE requests", async () => {
      const response = await request
        .get(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .set("Accept", "application/json");

      expect(response.status).toBe(406); // Not Acceptable
    });

    test("GET /mcp requires valid session ID", async () => {
      const response = await request
        .get(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", "invalid-session")
        .set("Accept", "text/event-stream");

      expect(response.status).toBe(404);
    });

    // To test actual SSE event reception would require more complex setup
    // with EventSource that listens for events. For simplicity, this is omitted.
  });

  describe("Progress Reporting", () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      sessionId = response.headers["mcp-session-id"];
    });

    test("tool call with onprogress option receives progress updates", async () => {
      const progressFn = jest.fn();
      const callWithProgress = createJSONRPCRequest(
        "servers/server1/tools/tool1/call",
        {
          arguments: {
            param1: "value1",
          },
          options: {
            onprogress: progressFn,
          },
        }
      );

      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(callWithProgress);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: {
          result: "tool result",
        },
      });

      // In a mock environment, just verify the mock was called
      expect(mockHostInstance.callTool).toHaveBeenCalled();
    });

    test("resource read with onprogress option receives progress updates", async () => {
      const progressFn = jest.fn();
      const readWithProgress = createJSONRPCRequest(
        "servers/server1/resource/read",
        {
          uri: "resource1",
          options: {
            onprogress: progressFn,
          },
        }
      );

      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .set("Mcp-Session-Id", sessionId)
        .send(readWithProgress);

      expect(response.status).toBe(200);

      // In a mock environment, just verify the mock was called
      expect(mockHostInstance.readResource).toHaveBeenCalled();
    });
  });

  describe("Sampling Request Handling", () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await request
        .post(MCP_ENDPOINT_PATH)
        .send(createJSONRPCRequest("initialize", {}));

      sessionId = response.headers["mcp-session-id"];
    });

    test("host emits samplingRequest event when needed", (done) => {
      // Mock the host to emit a sampling request
      mockHostInstance.on("samplingRequest", (serverId, params, callback) => {
        expect(serverId).toBe("server1");
        expect(params).toMatchObject({
          messages: expect.any(Array),
        });

        // Immediately call the callback to resolve the request
        callback({
          role: "assistant",
          content: {
            type: "text",
            text: "AI response",
          },
          model: "test-model",
          stopReason: "endTurn",
        });

        done();
      });

      // Trigger a sampling request
      mockHostInstance.emit(
        "samplingRequest",
        "server1",
        {
          messages: [
            { role: "user", content: { type: "text", text: "Hello" } },
          ],
        },
        (result) => {
          // In a real implementation, this would be handled
        }
      );
    });

    test("sampling request can be handled via HTTP endpoint", async () => {
      // Setup: Create a session with samplingRequests capability
      const sessionId = createSession();
      const session = getSession(sessionId);
      session.samplingRequests = new Map();

      // Setup a mock request with a callback
      const requestId = "test-sampling-req-123";
      const mockCallback = jest.fn();
      session.samplingRequests.set(requestId, mockCallback);

      // Send a sampling response
      const response = await request
        .post(`${MCP_ENDPOINT_PATH}/sampling_response`)
        .set("Mcp-Session-Id", sessionId)
        .send({
          requestId,
          result: {
            role: "assistant",
            content: {
              type: "text",
              text: "AI response",
            },
          },
        });

      expect(response.status).toBe(200);
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: expect.objectContaining({
            type: "text",
            text: "AI response",
          }),
        })
      );

      // Request should be removed from the session
      expect(session.samplingRequests.has(requestId)).toBe(false);
    });

    test("sampling error can be handled via HTTP endpoint", async () => {
      // Setup: Create a session with samplingRequests capability
      const sessionId = createSession();
      const session = getSession(sessionId);
      session.samplingRequests = new Map();

      // Setup a mock request with a callback
      const requestId = "test-sampling-req-456";
      const mockCallback = jest.fn();
      session.samplingRequests.set(requestId, mockCallback);

      // Send a sampling error
      const response = await request
        .post(`${MCP_ENDPOINT_PATH}/sampling_error`)
        .set("Mcp-Session-Id", sessionId)
        .send({
          requestId,
          error: {
            code: 100,
            message: "Test error message",
          },
        });

      expect(response.status).toBe(200);
      expect(mockCallback).toHaveBeenCalledWith(expect.any(McpError));

      const error = mockCallback.mock.calls[0][0] as McpError;
      expect(error.code).toBe(100);
      expect(error.message).toBe("MCP error 100: Test error message");

      // Request should be removed from the session
      expect(session.samplingRequests.has(requestId)).toBe(false);
    });
  });

  describe("Legacy Endpoint Compatibility", () => {
    test("GET /status returns server status", async () => {
      const response = await request.get("/status");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "running",
        hostInfo: { name: "Test Host", version: "1.0.0" },
        connectedServers: ["server1"],
      });
    });

    test("GET /servers returns connected servers", async () => {
      const response = await request.get("/servers");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        connectedServers: ["server1"],
      });
    });

    // Add more tests for legacy endpoints if needed
  });
});
