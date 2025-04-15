# Model Context Protocol (MCP): Conceptual Guide for Host Orchestration

## 1. Introduction

This document clarifies the intended design philosophy and typical interaction patterns for the core Model Context Protocol (MCP) primitives: Resources, Prompts, and Tools. This guide complements the SDK documentation by focusing on the ***design philosophy*** and ***intended interaction patterns*** for Host applications orchestrating MCP primitives. Understanding these roles is crucial for building robust and efficient Host applications that correctly leverage MCP servers and interact effectively with Large Language Models (LLMs).

The central principle is that the **Host application acts as the orchestrator**. It manages connections to MCP Servers (via MCP Clients), discovers capabilities, interacts with the user and the LLM, and decides *when* and *how* to utilize the primitives offered by the servers according to their intended purpose.

## 2. MCP Primitives: Roles and Control

MCP defines three primary server capabilities, each with a distinct control model and purpose:

### 2.1 Resources

*   **Purpose:** To provide **read-only data or context** to the Host/LLM. Resources represent information that can be looked up or retrieved.
*   **Examples:** File content, database records/schemas, API GET responses, git history, system status, configuration files.
*   **Control Model:** **Application/Host Controlled.** The Host decides *if*, *when*, and *how* to access resource data.
*   **MCP Interaction:**
    *   Discovery: Host uses `client.listResources()` / `client.listResourceTemplates()`.
    *   Access: Host uses `client.readResource({ uri: '...' })`.
    *   Updates (Optional): Host uses `client.subscribeToResource(...)` / `client.unsubscribeFromResource(...)` and listens for `notifications/resources/updated`.
*   **Typical Host-LLM Flow:**
    1.  **Proactive Fetching:** The Host determines (via configuration, heuristics, RAG, user context, etc.) that certain resource content is relevant *before* calling the LLM. It calls `readResource`, gets the content, and includes it in the `messages` array sent to the LLM (e.g., as a `system` or `user` message).
    2.  **LLM Request:** The LLM, potentially aware of resource URIs from prior context or discovery info provided by the Host, generates **text** asking the Host to fetch specific content (e.g., "Please provide the content of `file:///schema.sql`").
    3.  **Host Fulfillment:** The Host parses this text request, calls `readResource` for the requested URI, receives the content, and includes it in the *next* message sent back to the LLM.
*   **Key Takeaway:** Resources are passive data sources. The Host fetches them. The LLM requests them via text, not native tool calls.

### 2.2 Prompts

*   **Purpose:** To provide pre-defined **message structures or workflows** designed to initiate specific tasks or guide the LLM. They often bundle instructions *and* relevant context (fetched server-side).
*   **Examples:** A `/summarize <uri>` command template, a `/generate_commit_message` workflow, a `/debug_error <log_uri>` template, a prompt to synthesize documentation.
*   **Control Model:** **User Controlled.** Prompts are typically activated explicitly by the end-user through the Host's UI (slash commands, buttons, menus).
*   **MCP Interaction:**
    *   Discovery: Host uses `client.listPrompts()`.
    *   Activation: Host uses `client.getPrompt({ name: '...', arguments: {...} })`.
*   **Typical Host-LLM Flow:**
    1.  **User Activation:** User triggers a prompt via the Host UI (e.g., types `/synthesize_docs`).
    2.  **Host Action:** Host recognizes the command, maps it to the correct prompt name, and calls `client.getPrompt(...)`.
    3.  **Server Action:** The server's prompt handler executes. It *may* internally read necessary resources and constructs the `PromptMessage[]` array, embedding instructions and fetched resource content.
    4.  **Server Response:** Server returns the `GetPromptResult` containing the `PromptMessage[]`.
    5.  **Host Action:** Host receives the messages.
    6.  **Host -> LLM:** Host makes a **new API call** to the LLM, using the received `PromptMessage[]` as the primary input `messages`.
    7.  **LLM Action:** LLM executes the task based on the rich context provided in the messages.
*   **Key Takeaway:** Prompts are user-triggered recipes. The Host fetches the recipe (messages) from the server and gives it to the LLM to follow. The LLM doesn't "call" the prompt; it acts *on* the messages *from* the prompt.

### 2.3 Tools

*   **Purpose:** To allow the LLM (via the Host) to execute **actions** or **computations**. Tools interact with external systems, modify state, or perform operations beyond simple data retrieval.
*   **Examples:** Writing a file, running `npm run build`, calling a POST API, searching a database, performing a complex calculation.
*   **Control Model:** **Model Controlled (with Mandatory Host/User Approval).** The LLM typically decides which tool to use and provides the arguments based on the conversation. The Host **MUST** intercept this request and get explicit user confirmation before proceeding, *especially because tools can represent arbitrary, potentially destructive, code execution*.
*   **MCP Interaction:**
    *   Discovery: Host uses `client.listTools()`.
    *   Execution: Host uses `client.callTool({ name: '...', arguments: {...} })`.
*   **Typical Host-LLM Flow (Native Tool Calling):**
    1.  **Host -> LLM:** Host provides tool definitions (name, description, schema) in the LLM API's `tools` parameter.
    2.  **LLM -> Host:** LLM responds with `tool_calls` requesting a specific tool and arguments.
    3.  **Host Action:** Host intercepts `tool_calls`. **Performs Human-in-the-Loop (HITL) confirmation.**
    4.  **Host -> Server:** If approved, Host calls `client.callTool(...)` with the specified arguments.
    5.  **Server Action:** Server executes the tool logic.
    6.  **Server Response:** Server returns `CallToolResult` (containing success/error status and output content).
    7.  **Host Action:** Host receives the `CallToolResult`.
    8.  **Host -> LLM:** Host sends a `role: "tool"` message back to the LLM containing the `tool_call_id` and the (usually stringified) content from the `CallToolResult`.
    9.  **LLM Action:** LLM uses the tool result to continue the conversation or task.
*   **Key Takeaway:** Tools are actions. The LLM requests them via the API's tool mechanism, the Host confirms and executes via MCP, and the result is fed back to the LLM.

## 3. Orchestration Patterns in the Host

The Host application needs logic to manage these interactions:

*   **Capability Discovery:** On connection, use `listResources`, `listPrompts`, `listTools` to build an inventory of what each server offers.
*   **Context Preparation for LLM:** Decide what information to send to the LLM for each turn. This includes:
    *   Chat history.
    *   Proactively fetched Resource content (if any).
    *   Descriptions of available Tools (formatted for the LLM API).
    *   Descriptions of available Prompts (usually in a system message, explaining how the LLM can ask the Host to use them).
*   **LLM Response Handling:**
    *   If the LLM returns text asking to use a Prompt -> Parse text, call `client.getPrompt`, send resulting messages in a *new* LLM call.
    *   If the LLM returns text asking to read a Resource -> Parse text, call `client.readResource`, send resulting content back in the *next* LLM call (e.g., as `role: "user"`).
    *   If the LLM returns `tool_calls` -> Perform HITL, call `client.callTool`, send result back as `role: "tool"`.
*   **Human-in-the-Loop (HITL):** **Mandatory** before executing any `callTool`. Clearly present the tool, server, arguments, and potential impact to the user.

## 4. Avoiding Anti-Patterns

*   **Don't treat Prompts like Tools:** Avoid defining Prompts in the LLM API's `tools` parameter. Use text-based requests from the LLM to trigger `getPrompt` in the Host.
*   **Don't treat Resources like Tools:** Avoid defining "read resource" functions in the LLM API's `tools` parameter. Use text-based requests from the LLM to trigger `readResource` in the Host.
*   **Don't return complex input structures as Tool results:** A tool result should be the outcome of the action. If a tool needs to set up context for a *subsequent* LLM task, consider if a Prompt was the more appropriate primitive initially, or design the tool result to be simple status/confirmation data that the LLM can use to request the next step (which might involve the Host fetching a prompt or resource).

By respecting these intended roles and interaction patterns, Host applications can create powerful, secure, and maintainable integrations using the Model Context Protocol.