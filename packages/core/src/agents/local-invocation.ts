/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { LocalAgentExecutor } from './local-executor.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { BaseToolInvocation, type ToolResult } from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type {
  LocalAgentDefinition,
  AgentInputs,
  SubagentActivityEvent,
  OutputObject,
} from './types.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type AgentProgressStart,
  type AgentProgressUpdate,
  type AgentProgressComplete,
} from '../confirmation-bus/types.js';
import { randomUUID } from 'node:crypto';

const INPUT_PREVIEW_MAX_LENGTH = 50;
const DESCRIPTION_MAX_LENGTH = 200;

/**
 * Represents a validated, executable instance of a subagent tool.
 *
 * This class orchestrates the execution of a defined agent by:
 * 1. Initializing the {@link LocalAgentExecutor}.
 * 2. Running the agent's execution loop.
 * 3. Bridging the agent's streaming activity (e.g., thoughts) to the tool's
 * live output stream.
 * 4. Formatting the final result into a {@link ToolResult}.
 */
export class LocalSubagentInvocation extends BaseToolInvocation<
  AgentInputs,
  ToolResult
> {
  /**
   * @param definition The definition object that configures the agent.
   * @param config The global runtime configuration.
   * @param params The validated input parameters for the agent.
   * @param messageBus Optional message bus for policy enforcement.
   */
  constructor(
    private readonly definition: LocalAgentDefinition,
    private readonly config: Config,
    params: AgentInputs,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus, definition.name, definition.displayName);
  }

  /**
   * Returns a concise, human-readable description of the invocation.
   * Used for logging and display purposes.
   */
  getDescription(): string {
    const inputSummary = Object.entries(this.params)
      .map(
        ([key, value]) =>
          `${key}: ${String(value).slice(0, INPUT_PREVIEW_MAX_LENGTH)}`,
      )
      .join(', ');

    const description = `Running subagent '${this.definition.name}' with inputs: { ${inputSummary} }`;
    return description.slice(0, DESCRIPTION_MAX_LENGTH);
  }

  /**
   * Executes the subagent.
   *
   * @param signal An `AbortSignal` to cancel the agent's execution.
   * @param updateOutput A callback to stream intermediate output, such as the
   * agent's thoughts, to the user interface.
   * @returns A `Promise` that resolves with the final `ToolResult`.
   */
  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<ToolResult> {
    const executionStartTime = Date.now();
    const agentExecutionId = randomUUID();
    let output: OutputObject | null = null;
    let turnCount = 0;
    let toolCallsCount = 0;
    const filesAccessed: string[] = [];

    // Emit AGENT_PROGRESS_START event
    this.emitProgressStart(agentExecutionId, executionStartTime);

    try {
      if (updateOutput) {
        updateOutput('Subagent starting...\n');
      }

      // Create an activity callback to bridge the executor's events to the
      // tool's streaming output.
      const onActivity = (activity: SubagentActivityEvent): void => {
        if (
          activity.type === 'THOUGHT_CHUNK' &&
          typeof activity.data['text'] === 'string'
        ) {
          if (updateOutput) {
            // Clean UI without emojis
            updateOutput(`${activity.data['text']}`);
          }
        }

        // Track tool calls for metrics and emit progress updates
        if (activity.type === 'TOOL_CALL_START') {
          toolCallsCount++;
          const toolName = activity.data['tool_name'] as string | undefined;
          const filePath = activity.data['file_path'] as string | undefined;

          // Track files accessed
          if (filePath && !filesAccessed.includes(filePath)) {
            filesAccessed.push(filePath);
          }

          // Emit progress update
          this.emitProgressUpdate(
            agentExecutionId,
            `Using ${toolName || 'tool'}...`,
            'tool_use',
            toolName,
            toolCallsCount,
            turnCount,
            filesAccessed,
          );
        }
      };

      const executor = await LocalAgentExecutor.create(
        this.definition,
        this.config,
        onActivity,
      );

      output = await executor.run(this.params, signal);

      // Use actual counts from executor output (with fallback to tracked counts)
      turnCount =
        output.turn_count ?? Math.max(1, Math.floor(toolCallsCount / 2));
      toolCallsCount = output.tool_calls_count ?? toolCallsCount;

      const resultContent = `Subagent '${this.definition.name}' finished.
Termination Reason: ${output.terminate_reason}
Result:
${output.result}`;

      const displayContent = `
Subagent ${this.definition.name} Finished

Termination Reason:\n ${output.terminate_reason}

Result:
${output.result}
`;

      return {
        llmContent: [{ text: resultContent }],
        returnDisplay: displayContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        llmContent: `Subagent '${this.definition.name}' failed. Error: ${errorMessage}`,
        returnDisplay: `Subagent Failed: ${this.definition.name}\nError: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    } finally {
      // Emit AGENT_PROGRESS_COMPLETE event
      this.emitProgressComplete(
        agentExecutionId,
        output?.terminate_reason || 'UNKNOWN',
        Date.now() - executionStartTime,
        toolCallsCount,
        turnCount,
        output?.result?.slice(0, 200), // Brief summary
      );

      // Fire SubagentStop hook regardless of success or failure
      if (output) {
        const hookSystem = this.config.getHookSystem();
        if (hookSystem) {
          const hookHandler = hookSystem.getEventHandler();
          try {
            await hookHandler.fireSubagentStopEvent(
              this.definition.name,
              output.result || '',
              output.terminate_reason || 'UNKNOWN',
              Date.now() - executionStartTime,
              turnCount,
              toolCallsCount,
            );
          } catch (hookError) {
            // Log hook error but don't fail the agent execution
            console.warn(`SubagentStop hook error: ${hookError}`);
          }
        }
      }
    }
  }

  /**
   * Emits AGENT_PROGRESS_START event to MESSAGE_BUS.
   */
  private emitProgressStart(agentExecutionId: string, startTime: number): void {
    if (!this.messageBus) return;

    const event: AgentProgressStart = {
      type: MessageBusType.AGENT_PROGRESS_START,
      agentExecutionId,
      agentName: this.definition.name,
      displayName: this.definition.displayName,
      status: 'Launched',
      startTime,
    };

    void this.messageBus.publish(event);
  }

  /**
   * Emits AGENT_PROGRESS_UPDATE event to MESSAGE_BUS.
   */
  private emitProgressUpdate(
    agentExecutionId: string,
    status: string,
    activity: 'tool_use' | 'thinking' | 'searching' | 'writing' | 'other',
    details?: string,
    toolCallCount?: number,
    turnCount?: number,
    filesAccessed?: string[],
  ): void {
    if (!this.messageBus) return;

    const event: AgentProgressUpdate = {
      type: MessageBusType.AGENT_PROGRESS_UPDATE,
      agentExecutionId,
      agentName: this.definition.name,
      status,
      activity,
      details,
      toolCallCount,
      turnCount,
      filesAccessed,
    };

    void this.messageBus.publish(event);
  }

  /**
   * Emits AGENT_PROGRESS_COMPLETE event to MESSAGE_BUS.
   */
  private emitProgressComplete(
    agentExecutionId: string,
    terminateReason: string,
    executionTimeMs: number,
    toolCallCount: number,
    turnCount: number,
    resultSummary?: string,
  ): void {
    if (!this.messageBus) return;

    // Map terminate reason to status
    const statusMap: Record<string, AgentProgressComplete['status']> = {
      SUCCESS: 'success',
      TASK_COMPLETE: 'success',
      ABORT: 'aborted',
      TIMEOUT: 'timeout',
      CYCLE_DETECTED: 'cycle_detected',
      MAX_TURNS_EXCEEDED: 'timeout',
      ERROR: 'error',
    };

    const status = statusMap[terminateReason] || 'error';

    const event: AgentProgressComplete = {
      type: MessageBusType.AGENT_PROGRESS_COMPLETE,
      agentExecutionId,
      agentName: this.definition.name,
      status,
      terminateReason,
      executionTimeMs,
      toolCallCount,
      turnCount,
      resultSummary,
    };

    void this.messageBus.publish(event);
  }
}
