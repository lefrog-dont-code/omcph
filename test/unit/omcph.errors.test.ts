import { jest } from "@jest/globals";
import { McpClientHost, McpHostConfig } from "../../src/lib/index.js";
import { McpHostError, ErrorCodes } from "../../src/lib/errors.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe("McpClientHost Error Handling", () => {
  let host: McpClientHost;
  const mockSendRootsListChanged = jest.fn(() => Promise.resolve());

  const config: McpHostConfig = {
    hostInfo: { name: "TestHost", version: "1.0.0" },
    servers: [
      { id: "server1", transport: "stdio", command: "test1" },
      { id: "server2", transport: "stdio", command: "test2" },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    host = new McpClientHost(config);

    // Mock clients setup with proper typing
    (host as any).clients.set("server1", {
      getServerCapabilities: () => ({ roots: { listChanged: true } }),
      sendRootsListChanged: mockSendRootsListChanged,
    });

    (host as any).clients.set("server2", {
      getServerCapabilities: () => ({ roots: { listChanged: true } }),
      sendRootsListChanged: mockSendRootsListChanged,
    });
  });

  afterEach(async () => {
    await host.stop();
  });

  test("setRoots throws McpHostError for invalid input", async () => {
    await expect(host.setRoots(null as any)).rejects.toThrow(McpHostError);
  });

  test("setRoots collects errors from multiple servers", async () => {
    mockSendRootsListChanged
      .mockRejectedValueOnce(new Error("Server 1 failed"))
      .mockRejectedValueOnce(new Error("Server 2 failed"));

    const roots = [{ uri: "file:///root1", name: "Root 1" }];

    try {
      await host.setRoots(roots);
      fail("Expected setRoots to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
      const aggError = e as AggregateError;

      expect(aggError.errors).toHaveLength(2);
      expect(aggError.errors[0]).toBeInstanceOf(McpHostError);
      expect(aggError.errors[1]).toBeInstanceOf(McpHostError);

      const firstError = aggError.errors[0] as McpHostError;
      expect(firstError.code).toBe(ErrorCodes.ROOTS_UPDATE_FAILED);
      expect(firstError.serverId).toBeDefined();
    }
  });

  test("setRoots succeeds when some servers succeed", async () => {
    mockSendRootsListChanged
      .mockResolvedValueOnce(undefined) // server1 succeeds
      .mockRejectedValueOnce(new Error("Server 2 failed"));

    const roots = [{ uri: "file:///root1", name: "Root 1" }];

    try {
      await host.setRoots(roots);
      fail("Expected setRoots to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
      const aggError = e as AggregateError;

      expect(aggError.errors).toHaveLength(1);
      const error = aggError.errors[0] as McpHostError;
      expect(error.serverId).toBe("server2");
    }
  });

  test("McpHostError preserves error chain", async () => {
    const originalError = new Error("Original error");
    mockSendRootsListChanged.mockRejectedValueOnce(originalError);

    const roots = [{ uri: "file:///root1", name: "Root 1" }];

    try {
      await host.setRoots(roots);
      fail("Expected setRoots to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
      const aggError = e as AggregateError;

      const firstError = aggError.errors[0] as McpHostError;
      expect(firstError.cause).toBe(originalError);
    }
  });
});

describe("McpHostError", () => {
  describe("constructor", () => {
    it("should create an error with basic properties", () => {
      const error = new McpHostError(
        "Test error",
        ErrorCodes.CONNECTION_FAILED
      );

      expect(error).toBeInstanceOf(McpHostError);
      expect(error.message).toBe("Test error");
      expect(error.code).toBe(ErrorCodes.CONNECTION_FAILED);
      expect(error.name).toBe("McpHostError");
    });

    it("should include serverId when provided", () => {
      const error = new McpHostError(
        "Server connection failed",
        ErrorCodes.CONNECTION_FAILED,
        { serverId: "test-server" }
      );

      expect(error.serverId).toBe("test-server");
    });

    it("should capture and append cause message", () => {
      const originalError = new Error("Original network error");
      const error = new McpHostError(
        "Connection failed",
        ErrorCodes.CONNECTION_FAILED,
        {
          serverId: "test-server",
          cause: originalError,
        }
      );

      expect(error.message).toContain("Connection failed");
      expect(error.message).toContain("Original network error");
      expect(error.cause).toBe(originalError);
    });

    it("should not duplicate cause message if already included", () => {
      const originalError = new Error("Original network error");
      const error = new McpHostError(
        "Connection failed: Original network error",
        ErrorCodes.CONNECTION_FAILED,
        {
          serverId: "test-server",
          cause: originalError,
        }
      );

      expect(error.message).toBe("Connection failed: Original network error");
    });
  });

  describe("Error Code Consistency", () => {
    it("should have all expected error codes", () => {
      const expectedCodes = [
        "ROOTS_UPDATE_FAILED",
        "SERVER_NOT_FOUND",
        "INVALID_TRANSPORT",
        "CONNECTION_FAILED",
        "SUBSCRIPTION_FAILED",
        "TOOL_CALL_FAILED",
        "RESOURCE_READ_FAILED",
        "PROMPT_GET_FAILED",
      ];

      expectedCodes.forEach((code) => {
        expect(ErrorCodes).toHaveProperty(code);
      });
    });
  });

  describe("Error Handling Scenarios", () => {
    it("should wrap non-McpError with appropriate context", () => {
      const originalError = new Error("Unexpected failure");
      const hostError = new McpHostError(
        "Operation failed",
        ErrorCodes.TOOL_CALL_FAILED,
        {
          serverId: "test-server",
          cause: originalError,
        }
      );

      expect(hostError.code).toBe(ErrorCodes.TOOL_CALL_FAILED);
      expect(hostError.serverId).toBe("test-server");
      expect(hostError.cause).toBe(originalError);
      expect(hostError.message).toContain("Operation failed");
      expect(hostError.message).toContain("Unexpected failure");
    });

    it("should handle SDK McpError with original properties", () => {
      const sdkError = new McpError(
        ErrorCode.InternalError,
        "SDK internal error"
      );

      const hostError = new McpHostError(
        "SDK call failed",
        ErrorCodes.TOOL_CALL_FAILED,
        {
          serverId: "test-server",
          cause: sdkError,
        }
      );

      expect(hostError.code).toBe(ErrorCodes.TOOL_CALL_FAILED);
      expect(hostError.serverId).toBe("test-server");
      expect(hostError.cause).toBe(sdkError);
      expect(hostError.message).toContain("SDK call failed");
      expect(hostError.message).toContain("SDK internal error");
    });
  });
});
