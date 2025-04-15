export class McpHostError extends Error {
  public readonly serverId?: string;
  public readonly cause?: Error;

  constructor(
    message: string,
    public readonly code: string,
    options?: {
      serverId?: string;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = "McpHostError";
    this.serverId = options?.serverId;
    this.cause = options?.cause;

    // Capture stack trace properly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, McpHostError);
    }

    // If we have a cause, append its message to help with debugging
    if (this.cause && !message.includes(this.cause.message)) {
      this.message = `${message} (Cause: ${this.cause.message})`;
    }
  }
}

export const ErrorCodes = {
  ROOTS_UPDATE_FAILED: "ROOTS_UPDATE_FAILED",
  SERVER_NOT_FOUND: "SERVER_NOT_FOUND",
  INVALID_TRANSPORT: "INVALID_TRANSPORT",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  SUBSCRIPTION_FAILED: "SUBSCRIPTION_FAILED",
  TOOL_CALL_FAILED: "TOOL_CALL_FAILED",
  RESOURCE_READ_FAILED: "RESOURCE_READ_FAILED",
  PROMPT_GET_FAILED: "PROMPT_GET_FAILED",
} as const;

export type McpHostErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
