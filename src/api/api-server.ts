import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { McpClientHost, McpHostConfig } from "../lib/index.js";
import {
  CreateMessageResult,
  McpError,
  ErrorCode,
  Root,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Server as HttpServer } from "http";
import { Server as HttpsServer } from "https";

// Load environment variables from .env file if it exists
dotenv.config();

// Timeout for sampling requests (default: 30 seconds)
const SAMPLING_REQUEST_TIMEOUT_MS = parseInt(
  process.env.OMCPH_SAMPLING_TIMEOUT_MS || "30000",
  10
);
const MCP_ENDPOINT_PATH = process.env.OMCPH_MCP_ENDPOINT_PATH || "/mcp"; // Configurable endpoint path
const SESSION_TIMEOUT_MS = parseInt(
  process.env.OMCPH_SESSION_TIMEOUT_MS || "3600000", // 1 hour default
  10
);

// Define JSONRPCMessage as a union type since it's not exported from the SDK
type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// Define a custom error response type
interface JSONRPCErrorObject {
  code: number;
  message: string;
  data?: any;
}

interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JSONRPCErrorObject;
}

// --- Configuration Loading ---
function loadConfig(): McpHostConfig {
  const configPath = process.env.OMCPH_CONFIG_PATH;
  const defaultConfig: McpHostConfig = {
    hostInfo: { name: "OMCPH API Host", version: "0.1.0" },
    hostCapabilities: {
      sampling: {},
      roots: { listChanged: true },
    },
    servers: [],
  };

  // If no config path is provided, use default configuration
  if (!configPath) {
    console.log("No config path provided. Using default configuration.");
    return defaultConfig;
  }

  try {
    // Try to load and parse the config file
    const configFile = fs.readFileSync(configPath, "utf8");
    const fileConfig = JSON.parse(configFile);

    // Merge with default config to ensure required fields
    return {
      hostInfo: fileConfig.hostInfo || defaultConfig.hostInfo,
      hostCapabilities:
        fileConfig.hostCapabilities || defaultConfig.hostCapabilities,
      servers: fileConfig.servers || [],
    };
  } catch (err) {
    console.error(`Failed to load config from ${configPath}:`, err);
    console.log("Using default configuration.");
    return defaultConfig;
  }
}

const hostConfig = loadConfig();

if (hostConfig.servers.length === 0) {
  console.warn(
    "WARN: No MCP servers defined in hostConfig.servers. The API server will run but manage no connections."
  );
}

// --- Authentication Configuration ---
const apiKeys = new Set<string>(
  process.env.OMCPH_API_KEYS ? process.env.OMCPH_API_KEYS.split(",") : []
);
const authRequired =
  process.env.OMCPH_AUTH_REQUIRED !== "false" && apiKeys.size > 0;

if (authRequired) {
  console.log(`Authentication is enabled with ${apiKeys.size} API key(s)`);
} else if (apiKeys.size > 0) {
  console.log("Authentication is disabled despite API keys being configured");
} else {
  console.log("Authentication is disabled (no API keys configured)");
}

// --- Instantiate Host ---
console.log("Instantiating McpClientHost...");
const host = new McpClientHost(hostConfig);
console.log("McpClientHost instantiated.");

// --- Express App Setup ---
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// Add security middleware
app.use(helmet());

// API Key Authentication middleware
const authenticate = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (!authRequired) {
    return next();
  }

  const apiKey = req.headers["x-api-key"] as string;

  if (!apiKey || !apiKeys.has(apiKey)) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Invalid or missing API key",
    });
  }

  next();
};

// Add rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
app.use(limiter);

// Apply authentication to all routes
app.use(authenticate);

const port = process.env.OMCPH_API_PORT || 3000;

// --- Session Management (In-Memory Example) ---
interface SessionState {
  id: string;
  lastActivity: number;
  // Track any active SSE response stream
  sseConnection?: {
    res: express.Response;
    lastEventId: number;
  };
  // Queue of events that have occurred for this session
  eventQueue: Array<{ id: number; event: string; data: any }>;
  nextEventId: number;
  // Map to track pending sampling requests
  samplingRequests?: Map<
    string,
    (result: CreateMessageResult | McpError) => void
  >;
}
const activeSessions = new Map<string, SessionState>();

function createSession(): SessionState {
  const sessionId = randomUUID();
  const session: SessionState = {
    id: sessionId,
    lastActivity: Date.now(),
    eventQueue: [],
    nextEventId: 1,
    samplingRequests: new Map(),
  };
  activeSessions.set(sessionId, session);
  console.log(`Session created: ${sessionId}`);
  return session;
}

function getSession(sessionId: string): SessionState | undefined {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now(); // Update activity timestamp
  }
  return session;
}

function deleteSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (session && session.sseConnection) {
    // Close SSE connection if it exists
    try {
      session.sseConnection.res.end();
    } catch (error) {
      console.error(
        `Error closing SSE connection for session ${sessionId}:`,
        error
      );
    }

    // If there are any pending sampling requests being handled by this session,
    // reject them with an error
    if (session.samplingRequests) {
      for (const [requestId, callback] of session.samplingRequests.entries()) {
        callback(
          new McpError(
            ErrorCode.InternalError,
            "Session closed before sampling request could complete"
          )
        );
      }
      session.samplingRequests.clear();
    }
  }

  const deleted = activeSessions.delete(sessionId);
  if (deleted) {
    console.log(`Session deleted: ${sessionId}`);
  }
  return deleted;
}

// Send an SSE event to a session if it has an active SSE connection
function sendEventToSession(
  sessionId: string,
  eventName: string,
  data: any
): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  // Store event in queue for possible replay
  const eventId = session.nextEventId++;
  session.eventQueue.push({
    id: eventId,
    event: eventName,
    data,
  });

  // Keep queue size manageable (retain last 100 events)
  if (session.eventQueue.length > 100) {
    session.eventQueue.shift();
  }

  // If session has active SSE connection, send the event
  if (session.sseConnection) {
    try {
      const res = session.sseConnection.res;
      const eventData = JSON.stringify(data);
      res.write(`id: ${eventId}\n`);
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${eventData}\n\n`);
      return true;
    } catch (error) {
      console.error(`Error sending SSE event to session ${sessionId}:`, error);
      // If sending fails, consider the connection dead
      delete session.sseConnection;
      return false;
    }
  }

  return false;
}

// Session cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      console.log(`Session timed out: ${sessionId}`);
      deleteSession(sessionId);
      // TODO: Notify associated MCP client host to clean up resources if necessary
    }
  }
}, 60000); // Check every minute

// --- Subscribe to host events and relay them to sessions ---
host.on("serverConnected", (serverId) => {
  // Broadcast to all active sessions
  activeSessions.forEach((session, sessionId) => {
    sendEventToSession(sessionId, "serverConnected", { serverId });
  });
});

host.on("serverDisconnected", (serverId, error) => {
  activeSessions.forEach((session, sessionId) => {
    sendEventToSession(sessionId, "serverDisconnected", {
      serverId,
      error: error ? { message: error.message } : undefined,
    });
  });
});

host.on("capabilitiesUpdated", () => {
  activeSessions.forEach((session, sessionId) => {
    sendEventToSession(sessionId, "capabilitiesUpdated", {});
  });
});

host.on("resourceUpdated", (serverId, uri) => {
  activeSessions.forEach((session, sessionId) => {
    sendEventToSession(sessionId, "resourceUpdated", { serverId, uri });
  });
});

// Log events could be very chatty, so consider if you want to send all of them
host.on("log", (level, message, data) => {
  if (level === "error" || level === "warn") {
    activeSessions.forEach((session, sessionId) => {
      sendEventToSession(sessionId, "log", { level, message, data });
    });
  }
});

// --- Helper Functions ---
const handleHostError = (res: express.Response, error: unknown) => {
  console.error("API Error:", error);
  if (error instanceof McpError) {
    // Map MCP errors to appropriate HTTP status codes
    const status =
      error.code === ErrorCode.MethodNotFound ||
      error.code === ErrorCode.InvalidParams
        ? 400
        : 500;
    res.status(status).json({
      error: "mcp_error",
      code: error.code,
      message: error.message,
      data: error.data,
    });
  } else if (error instanceof Error) {
    res
      .status(500)
      .json({ error: "internal_server_error", message: error.message });
  } else {
    res.status(500).json({
      error: "unknown_error",
      message: "An unexpected error occurred",
    });
  }
};

// --- Streamable HTTP Endpoint (/mcp) ---

// Helper to check if a message is a request
const isRequest = (msg: any): msg is JSONRPCRequest =>
  msg &&
  typeof msg.method === "string" &&
  msg.id !== undefined &&
  msg.id !== null;

// Helper to check if a message is a notification
const isNotification = (msg: any): msg is JSONRPCNotification =>
  msg && typeof msg.method === "string" && msg.id === undefined;

// Helper to check if a message is a response
const isResponse = (msg: any): msg is JSONRPCResponse =>
  msg &&
  msg.id !== undefined &&
  (msg.result !== undefined || msg.error !== undefined);

// Helper to create an error response
function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: any
): JSONRPCErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

app.post(MCP_ENDPOINT_PATH, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const acceptsSSE = req.accepts("text/event-stream");
  const body = req.body;
  let session: SessionState | undefined;

  // --- Request Processing Logic ---
  const processSingleMessage = async (
    message: JSONRPCMessage
  ): Promise<JSONRPCResponse | JSONRPCErrorResponse | null> => {
    // Check for initialization request
    if (isRequest(message) && message.method === "initialize") {
      if (sessionId) {
        return createErrorResponse(
          message.id,
          -32600,
          "Cannot initialize an existing session"
        );
      }
      // Create new session
      const newSession = createSession();
      res.setHeader("Mcp-Session-Id", newSession.id);

      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: hostConfig.hostCapabilities || {},
          serverInfo: hostConfig.hostInfo,
        },
      };
    }

    // For all other messages, require a valid session ID
    if (!sessionId) {
      return createErrorResponse(
        isRequest(message) ? message.id : null,
        -32600,
        "Mcp-Session-Id header required after initialization"
      );
    }

    session = getSession(sessionId);
    if (!session) {
      return createErrorResponse(
        isRequest(message) ? message.id : null,
        -32600,
        "Invalid or expired session ID"
      );
    }

    // Handle requests (responses and notifications don't get a response back)
    if (isRequest(message)) {
      try {
        let result: any;
        // Extract serverId/toolName/etc. from method if applicable
        const methodParts = message.method.split("/");
        const serverId = methodParts[1]; // Assuming format like "servers/serverId/..."

        switch (message.method) {
          case "tools/list":
            result = host.getTools();
            break;
          case "resources/list":
            result = host.getResources();
            break;
          case "resources/templates/list":
            result = host.getResourceTemplates();
            break;
          case "prompts/list":
            result = host.getPrompts();
            break;
          // Add cases for specific server actions
          case `servers/${serverId}/tools/${methodParts[3]}/call`:
            result = await host.callTool(serverId, {
              name: methodParts[3],
              arguments: message.params,
            });
            break;
          case `servers/${serverId}/resource/read`:
            result = await host.readResource(serverId, message.params);
            break;
          case `servers/${serverId}/prompt/get`:
            result = await host.getPrompt(serverId, message.params);
            break;
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Method not found: ${message.method}`
            );
        }
        return { jsonrpc: "2.0", id: message.id, result };
      } catch (error) {
        const mcpError =
          error instanceof McpError
            ? error
            : new McpError(
                ErrorCode.InternalError,
                error instanceof Error ? error.message : "Unknown error"
              );
        return createErrorResponse(
          message.id,
          mcpError.code,
          mcpError.message,
          mcpError.data
        );
      }
    } else if (isNotification(message) || isResponse(message)) {
      // For notifications/responses, log and return null (no response)
      console.log(
        `Received ${
          isNotification(message) ? "notification" : "response"
        } for session ${sessionId}: ${
          isNotification(message) ? message.method : "response"
        }`
      );
      return null;
    } else {
      // Invalid message format
      return createErrorResponse(
        null,
        -32600,
        "Invalid JSON-RPC message structure"
      );
    }
  };

  // --- Batch vs Single Message Handling ---
  let responses: (JSONRPCResponse | JSONRPCErrorResponse | null)[] = [];
  let containsRequest = false;

  if (Array.isArray(body)) {
    // Batch request
    containsRequest = body.some(isRequest);
    responses = await Promise.all(body.map(processSingleMessage));
  } else {
    // Single request
    containsRequest = isRequest(body);
    const response = await processSingleMessage(body);
    responses.push(response);
  }

  // Filter out null responses (which came from notifications)
  const validResponses = responses.filter(
    (r): r is JSONRPCResponse | JSONRPCErrorResponse => r !== null
  );

  // Check if client prefers SSE responses for streaming operations
  const preferSSE =
    acceptsSSE &&
    // Assumption: any call that might benefit from streaming would have options.onprogress
    (body.params?.options?.onprogress !== undefined ||
      body.method === "initialize");

  if (preferSSE && sessionId) {
    // Client prefers streaming and we have a session - send SSE response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n"); // Initial newline for SSE

    const session = getSession(sessionId);
    if (session) {
      // First, immediately send initial response
      if (validResponses.length > 0) {
        const payload =
          validResponses.length === 1 && !Array.isArray(body)
            ? validResponses[0]
            : validResponses;

        res.write(`event: response\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }

      // Then, setup the SSE connection
      session.sseConnection = {
        res,
        lastEventId: session.nextEventId,
      };

      // Keep connection alive with heartbeats
      const intervalId = setInterval(() => {
        res.write(":heartbeat\n\n");
      }, 15000);

      // Clean up when client disconnects
      req.on("close", () => {
        clearInterval(intervalId);

        // Remove SSE connection from session
        const session = getSession(sessionId);
        if (session && session.sseConnection?.res === res) {
          delete session.sseConnection;
        }

        console.log(`SSE response connection closed for session ${sessionId}`);
      });
    }
    return; // We've already started responding with SSE
  }

  // Standard JSON-RPC response handling
  if (!containsRequest) {
    // Only notifications/responses were received
    res.status(202).send();
  } else if (validResponses.length === 0) {
    // Requests were received, but resulted in no responses
    res.status(204).send();
  } else if (validResponses.length === 1 && !Array.isArray(body)) {
    // Single request resulted in single response
    res.status(200).json(validResponses[0]);
  } else {
    // Batch request resulted in multiple responses
    res.status(200).json(validResponses);
  }
});

app.get(MCP_ENDPOINT_PATH, (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const lastEventId = req.headers["last-event-id"];

  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res
      .status(404)
      .json({ error: "not_found", message: "Invalid or expired session ID" });
  }

  if (req.accepts("text/event-stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n"); // Initial newline for SSE

    // If Last-Event-ID header is present, send missed events
    if (lastEventId && !isNaN(parseInt(lastEventId as string))) {
      const eventIdNum = parseInt(lastEventId as string);
      // Send any missed events
      session.eventQueue.forEach((event) => {
        if (event.id > eventIdNum) {
          res.write(`id: ${event.id}\n`);
          res.write(`event: ${event.event}\n`);
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
      });
    }

    // Register this response as the session's SSE connection
    session.sseConnection = {
      res,
      lastEventId: session.nextEventId - 1,
    };

    // Send current capabilities as an initial event
    sendEventToSession(sessionId, "initialState", {
      tools: host.getTools(),
      resources: host.getResources(),
      resourceTemplates: host.getResourceTemplates(),
      prompts: host.getPrompts(),
      connectedServers: Array.from(host.getConnectedClients().keys()),
    });

    // Keep connection open, send heartbeats
    const intervalId = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, 15000); // Send a comment every 15s

    req.on("close", () => {
      clearInterval(intervalId);

      // Remove SSE connection from session if it matches this response
      if (session.sseConnection?.res === res) {
        delete session.sseConnection;
      }

      console.log(`SSE connection closed for session ${sessionId}`);
    });
  } else {
    res.status(406).json({
      error: "not_acceptable",
      message: "Client must accept text/event-stream",
    });
  }
});

app.delete(MCP_ENDPOINT_PATH, (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  const deleted = deleteSession(sessionId);

  if (deleted) {
    res.status(204).send(); // No Content
  } else {
    res
      .status(404)
      .json({ error: "not_found", message: "Session ID not found" });
  }
});

// --- NEW: Handle sampling request completion via SSE ---
app.post(`${MCP_ENDPOINT_PATH}/sampling_response`, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res
      .status(404)
      .json({ error: "not_found", message: "Invalid or expired session ID" });
  }

  const { requestId, result } = req.body;
  if (!requestId || !result) {
    return res.status(400).json({
      error: "bad_request",
      message: "Invalid request body: requestId and result are required",
    });
  }

  if (!session.samplingRequests) {
    return res.status(404).json({
      error: "not_found",
      message: "No sampling requests registered for this session",
    });
  }

  const callback = session.samplingRequests.get(requestId);
  if (!callback) {
    return res.status(404).json({
      error: "not_found",
      message: "Request ID not found or already handled",
    });
  }

  // Call the callback with the result
  callback(result);
  session.samplingRequests.delete(requestId);
  res.status(200).json({ status: "success" });
});

app.post(`${MCP_ENDPOINT_PATH}/sampling_error`, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    return res.status(400).json({
      error: "bad_request",
      message: "Mcp-Session-Id header required",
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res
      .status(404)
      .json({ error: "not_found", message: "Invalid or expired session ID" });
  }

  const { requestId, error } = req.body;
  if (
    !requestId ||
    !error ||
    typeof error.code !== "number" ||
    typeof error.message !== "string"
  ) {
    return res.status(400).json({
      error: "bad_request",
      message:
        "Invalid request body: requestId and properly formatted error are required",
    });
  }

  if (!session.samplingRequests) {
    return res.status(404).json({
      error: "not_found",
      message: "No sampling requests registered for this session",
    });
  }

  const callback = session.samplingRequests.get(requestId);
  if (!callback) {
    return res.status(404).json({
      error: "not_found",
      message: "Request ID not found or already handled",
    });
  }

  // Call the callback with the error
  callback(new McpError(error.code, error.message, { data: error.data }));
  session.samplingRequests.delete(requestId);
  res.status(200).json({ status: "success" });
});

// --- Legacy HTTP Endpoints (Keep for backward compatibility) ---
// GET /status, /servers, /capabilities/*, /config/roots
// POST /servers/:serverId/tools/:toolName/call, /servers/:serverId/resource/read, etc.
// Mark these as deprecated in the documentation.
app.get("/status", (req, res) => {
  // Keep existing implementation
  res.json({
    status: "running",
    hostInfo: hostConfig.hostInfo,
    connectedServers: Array.from(host.getConnectedClients().keys()),
  });
});

app.get("/servers", (req, res) => {
  // Keep existing implementation
  const connected = Array.from(host.getConnectedClients().keys());
  res.json({ connectedServers: connected });
});

// Capability endpoints
app.get("/capabilities/tools", (req, res) => {
  try {
    res.json(host.getTools());
  } catch (error) {
    handleHostError(res, error);
  }
});

app.get("/capabilities/resources", (req, res) => {
  try {
    res.json(host.getResources());
  } catch (error) {
    handleHostError(res, error);
  }
});

app.get("/capabilities/templates", (req, res) => {
  try {
    res.json(host.getResourceTemplates());
  } catch (error) {
    handleHostError(res, error);
  }
});

app.get("/capabilities/prompts", (req, res) => {
  try {
    res.json(host.getPrompts());
  } catch (error) {
    handleHostError(res, error);
  }
});

// Server suggestion endpoints
app.get("/suggest/resource", (req, res) => {
  const uri = req.query.uri as string;
  if (!uri) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing uri query parameter",
    });
  }

  try {
    const suggestions = host.suggestServerForUri(uri);
    res.json(suggestions);
  } catch (error) {
    handleHostError(res, error);
  }
});

app.get("/suggest/tool", (req, res) => {
  const name = req.query.name as string;
  if (!name) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing name query parameter",
    });
  }

  try {
    const suggestions = host.suggestServerForTool(name);
    res.json(suggestions);
  } catch (error) {
    handleHostError(res, error);
  }
});

app.get("/suggest/prompt", (req, res) => {
  const name = req.query.name as string;
  if (!name) {
    return res.status(400).json({
      error: "bad_request",
      message: "Missing name query parameter",
    });
  }

  try {
    const suggestions = host.suggestServerForPrompt(name);
    res.json(suggestions);
  } catch (error) {
    handleHostError(res, error);
  }
});

// Configuration endpoints
app.get("/config/roots", (req, res) => {
  try {
    res.json(host.getCurrentRoots());
  } catch (error) {
    handleHostError(res, error);
  }
});

// Add request validation middleware
const validateRoots = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const roots = req.body;
  if (!Array.isArray(roots)) {
    return res.status(400).json({
      error: "invalid_roots",
      message: "Request body must be an array of Root objects",
    });
  }

  if (
    !roots.every(
      (root) =>
        typeof root === "object" &&
        root !== null &&
        typeof root.uri === "string" &&
        typeof root.name === "string"
    )
  ) {
    return res.status(400).json({
      error: "invalid_roots",
      message: "Each root must have uri and name properties as strings",
    });
  }
  next();
};

app.post("/config/roots", validateRoots, (req, res) => {
  const roots = req.body;

  host
    .setRoots(roots as Root[])
    .then(() => {
      res.status(200).json({ message: "Roots updated successfully" });
    })
    .catch((error) => {
      handleHostError(res, error);
    });
});

// --- WebSocket Server Setup (for events and sampling flow) ---
const server: HttpServer | HttpsServer = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const activeConnections: Map<
  WebSocket,
  {
    id: string;
    subscriptions: Set<string>;
    samplingRequests: Map<
      string,
      (result: CreateMessageResult | McpError) => void
    >;
  }
> = new Map();

const generateId = () => randomUUID();

wss.on("connection", (ws, req) => {
  // Authentication for WebSocket
  if (authRequired) {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const queryApiKey = url.searchParams.get("apiKey");
    const headerApiKey = req.headers["x-api-key"];
    const apiKey = queryApiKey || headerApiKey;

    if (!apiKey || !apiKeys.has(apiKey as string)) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: "unauthorized",
          message: "Invalid or missing API key",
        })
      );
      ws.close(1008, "Unauthorized");
      return;
    }
  }

  const connectionId = generateId();
  activeConnections.set(ws, {
    id: connectionId,
    subscriptions: new Set(),
    samplingRequests: new Map(),
  });
  ws.send(
    JSON.stringify({
      type: "connection",
      connectionId,
      message: "Connected to MCP API WebSocket Server",
    })
  );

  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30000);

  ws.on("close", () => {
    const connection = activeConnections.get(ws);
    if (connection) activeConnections.delete(ws);
    clearInterval(pingInterval);
    console.log(`WebSocket connection closed: ${connection?.id}`);
  });

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      console.error("Invalid WebSocket message format:", error);
      return;
    }

    switch (data.type) {
      case "subscribe":
        handleSubscribeMessage(ws, data);
        break;
      case "unsubscribe":
        handleUnsubscribeMessage(ws, data);
        break;
      // --- NEW: Handle sampling responses/errors coming back from the client ---
      case "sampling_response":
        handleSamplingResponseMessage(ws, data);
        break;
      case "sampling_error":
        handleSamplingErrorMessage(ws, data);
        break;
      default:
        console.warn(`Unknown WebSocket message type: ${data.type}`);
        break;
    }
  });
});

// --- WebSocket Message Handlers ---
function handleSubscribeMessage(ws: WebSocket, data: any) {
  const connection = activeConnections.get(ws);
  if (!connection) return;

  const { topic } = data;
  if (!topic || typeof topic !== "string") return;

  connection.subscriptions.add(topic);
  ws.send(JSON.stringify({ type: "subscribed", topic }));
}

function handleUnsubscribeMessage(ws: WebSocket, data: any) {
  const connection = activeConnections.get(ws);
  if (!connection) return;

  const { topic } = data;
  if (!topic || typeof topic !== "string") return;

  connection.subscriptions.delete(topic);
  ws.send(JSON.stringify({ type: "unsubscribed", topic }));
}

// --- NEW: Handle responses/errors coming back for sampling requests ---
function handleSamplingResponseMessage(ws: WebSocket, data: any) {
  const connection = activeConnections.get(ws);
  if (!connection) return;
  const { requestId, result } = data;
  if (!requestId || !result) {
    console.warn(
      "Invalid sampling_response message (missing requestId or result)"
    );
    return;
  }

  const callback = connection.samplingRequests.get(requestId);
  if (callback) {
    callback(result as CreateMessageResult); // Assume result matches CreateMessageResult
    connection.samplingRequests.delete(requestId);
  } else {
    console.warn(
      `Received sampling_response for unknown/timed out requestId: ${requestId}`
    );
  }
}

function handleSamplingErrorMessage(ws: WebSocket, data: any) {
  const connection = activeConnections.get(ws);
  if (!connection) return;
  const { requestId, error } = data;
  if (
    !requestId ||
    !error ||
    typeof error.code !== "number" ||
    typeof error.message !== "string"
  ) {
    console.warn(
      "Invalid sampling_error message (missing requestId or invalid error object)"
    );
    return;
  }

  const callback = connection.samplingRequests.get(requestId);
  if (callback) {
    callback(new McpError(error.code, error.message, { data: error.data }));
    connection.samplingRequests.delete(requestId);
  } else {
    console.warn(
      `Received sampling_error for unknown/timed out requestId: ${requestId}`
    );
  }
}
// --- End Sampling Response/Error Handling ---

// --- Event Handlers (Broadcasting via WebSocket) ---
// Resource updated event
host.on("resourceUpdated", (serverId, uri) => {
  const message = JSON.stringify({ type: "resource_updated", serverId, uri });
  for (const [ws, connection] of activeConnections.entries()) {
    if (
      connection.subscriptions.has("resources") ||
      connection.subscriptions.has(`resource:${uri}`) ||
      connection.subscriptions.has(`server:${serverId}`)
    ) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
    }
  }
});

// Server connected event
host.on("serverConnected", (serverId) => {
  const message = JSON.stringify({
    type: "server_connected",
    serverId,
  });

  // Send to all connections - this is a general event that all clients should know about
  for (const [ws, connection] of activeConnections.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
});

// Server disconnected event
host.on("serverDisconnected", (serverId, error) => {
  const message = JSON.stringify({
    type: "server_disconnected",
    serverId,
    error: error ? error.message : undefined,
  });

  // Send to all connections - this is a general event that all clients should know about
  for (const [ws, connection] of activeConnections.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
});

// Capabilities updated event
host.on("capabilitiesUpdated", () => {
  const message = JSON.stringify({
    type: "capabilities_updated",
  });

  // Send to all connections - this is a general event that all clients should know about
  for (const [ws, connection] of activeConnections.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
});

// --- NEW: Sampling Request Handling (via WebSocket or SSE) ---
host.on("samplingRequest", (serverId, params, callback) => {
  const requestId = randomUUID(); // Generate unique ID for this request

  // Find a WebSocket connection to send the request to
  let clientWs: WebSocket | null = null;
  for (const ws of activeConnections.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      clientWs = ws;
      break;
    }
  }

  if (clientWs) {
    // We have a WebSocket connection - use that
    const connection = activeConnections.get(clientWs)!; // We know it exists
    connection.samplingRequests.set(requestId, callback);

    // Set a timeout to clean up abandoned requests
    const timeoutId = setTimeout(() => {
      if (connection.samplingRequests.has(requestId)) {
        connection.samplingRequests.delete(requestId);
        callback(
          new McpError(
            ErrorCode.RequestTimeout,
            "Sampling request timed out - no response received"
          )
        );
      }
    }, 300000); // 5-minute timeout

    // Send the request to the client
    clientWs.send(
      JSON.stringify({
        type: "sampling_request",
        requestId,
        serverId,
        params,
      })
    );
    return;
  }

  // No WebSocket connection available - check for any active SSE sessions
  // Find any session with an active SSE connection
  let activeSession: SessionState | undefined;
  for (const [sessionId, session] of activeSessions.entries()) {
    if (session.sseConnection && session.sseConnection.res.writable) {
      activeSession = session;
      break;
    }
  }

  if (activeSession) {
    // We have an active SSE session - use that
    if (!activeSession.samplingRequests) {
      activeSession.samplingRequests = new Map();
    }

    activeSession.samplingRequests.set(requestId, callback);

    // Set a timeout to clean up abandoned requests
    setTimeout(() => {
      if (
        activeSession &&
        activeSession.samplingRequests &&
        activeSession.samplingRequests.has(requestId)
      ) {
        activeSession.samplingRequests.delete(requestId);
        callback(
          new McpError(
            ErrorCode.RequestTimeout,
            "Sampling request timed out - no response received"
          )
        );
      }
    }, 300000); // 5-minute timeout

    // Send the request via SSE
    sendEventToSession(activeSession.id, "sampling_request", {
      requestId,
      serverId,
      params,
    });

    return;
  }

  // No WebSocket and no SSE session - reject the request
  console.error(
    "Sampling request received, but no active WebSocket or SSE clients found."
  );
  callback(
    new McpError(
      ErrorCode.InternalError,
      "No active client to handle sampling request"
    )
  );
});

// Start the server and host
server.listen(port, () => {
  console.log(`MCP API Server listening on port ${port}`);
  console.log(`MCP Endpoint: ${MCP_ENDPOINT_PATH}`);
  console.log(`WebSocket Endpoint: /ws`);

  host
    .start()
    .then(() => console.log("MCP Host started successfully."))
    .catch((error) => console.error("Error starting MCP Host:", error));
});

// --- Graceful Shutdown ---
const shutdown = async (signal: string) => {
  console.log(`\n${signal} signal received. Shutting down gracefully...`);
  // 1. Close WebSocket connections
  console.log("Closing WebSocket connections...");
  for (const [ws] of activeConnections) {
    ws.terminate(); // Force close immediately
  }
  activeConnections.clear();

  // 2. Stop the McpClientHost
  console.log("Stopping McpClientHost...");
  try {
    await host.stop();
    console.log("McpClientHost stopped.");
  } catch (err) {
    console.error("Error stopping McpClientHost:", err);
  }

  // 3. Close the HTTP server
  console.log("Closing HTTP server...");
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0); // Exit process
  });

  // Force exit if server doesn't close gracefully within a timeout
  setTimeout(() => {
    console.error("Could not close connections in time, forcing shut down.");
    process.exit(1);
  }, 10000); // 10 seconds timeout
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Export for testing
export { server, wss, host };
export default app;
