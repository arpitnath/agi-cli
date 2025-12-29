/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type PlanModeApprovalRequest,
  type PlanModeApprovalResponse,
} from '../confirmation-bus/types.js';
import {
  EXIT_PLAN_MODE_TOOL_NAME,
  PLAN_MODE_BLOCKED_TOOLS,
  WRITE_FILE_TOOL_NAME,
} from './tool-names.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DESCRIPTION = `Exit Plan Mode after completing your implementation plan.

The user will be asked to approve the plan before implementation tools are re-enabled.
If no plan_file_path is provided, uses the plan file path set when entering plan mode.

If the plan is approved, all tools will be available for implementation.
If the user requests revisions, you'll remain in Plan Mode to revise the plan.`;

const ExitPlanModeParamsSchema = z.object({
  plan_file_path: z
    .string()
    .optional()
    .describe(
      'Path to the plan file. If not provided, uses the path set when entering plan mode.',
    ),
  summary: z
    .string()
    .optional()
    .describe('Brief summary of the plan for user review'),
});

export type ExitPlanModeParams = z.infer<typeof ExitPlanModeParamsSchema>;

/**
 * Tool for exiting Plan Mode - triggers user approval of the plan.
 */
export class ExitPlanModeTool extends BaseDeclarativeTool<
  ExitPlanModeParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      EXIT_PLAN_MODE_TOOL_NAME,
      'Exit Plan Mode',
      DESCRIPTION,
      Kind.Think,
      zodToJsonSchema(ExitPlanModeParamsSchema),
      /* isOutputMarkdown */ false,
      /* canUpdateOutput */ false,
      messageBus,
    );
  }

  protected createInvocation(
    params: ExitPlanModeParams,
  ): ExitPlanModeInvocation {
    return new ExitPlanModeInvocation(params, this.config, this.messageBus);
  }
}

/**
 * Invocation instance for exit_plan_mode tool.
 * Handles the user approval flow via MESSAGE_BUS.
 */
class ExitPlanModeInvocation extends BaseToolInvocation<
  ExitPlanModeParams,
  ToolResult
> {
  constructor(
    params: ExitPlanModeParams,
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus, EXIT_PLAN_MODE_TOOL_NAME);
  }

  /**
   * Skip tool confirmation - approval is handled via MESSAGE_BUS.
   */
  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<false> {
    return false;
  }

  getDescription(): string {
    return `Exiting Plan Mode (awaiting approval for: ${this.params.plan_file_path})`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    // Check if not in plan mode
    if (!this.config.getIsPlanMode()) {
      return {
        llmContent: 'Not currently in Plan Mode. No action needed.',
        returnDisplay: 'Not in Plan Mode',
      };
    }

    // Resolve plan file path - use param if provided, otherwise use config
    let planPath: string;
    if (this.params.plan_file_path) {
      planPath = path.isAbsolute(this.params.plan_file_path)
        ? this.params.plan_file_path
        : path.resolve(this.config.getWorkingDir(), this.params.plan_file_path);
    } else {
      const configPath = this.config.getPlanFilePath();
      if (!configPath) {
        return {
          llmContent:
            'No plan file path specified. Please provide a plan_file_path or re-enter plan mode.',
          returnDisplay: 'No plan file path',
          error: {
            message: 'No plan file path specified',
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }
      planPath = configPath;
    }

    try {
      await fs.access(planPath);
    } catch {
      return {
        llmContent: `Plan file not found: ${planPath}. Please create the plan file first.`,
        returnDisplay: `Plan file not found: ${planPath}`,
        error: {
          message: 'Plan file not found',
          type: ToolErrorType.FILE_NOT_FOUND,
        },
      };
    }

    // Request user approval via MESSAGE_BUS
    if (!this.messageBus) {
      return {
        llmContent:
          'Cannot request approval in non-interactive mode. Exiting plan mode without approval.',
        returnDisplay: 'Non-interactive mode - approval skipped',
      };
    }

    try {
      const response = await this.requestApproval(planPath, signal);

      if (response.approved) {
        // Disable plan mode
        this.config.setIsPlanMode(false);
        this.config.setPlanFilePath(planPath);

        // Remove blocking rules from PolicyEngine
        const policyEngine = this.config.getPolicyEngine();
        for (const toolName of PLAN_MODE_BLOCKED_TOOLS) {
          policyEngine.removeRulesForTool(toolName);
        }
        // Also remove the ALLOW rule for write_file to plan file
        policyEngine.removeRulesForTool(WRITE_FILE_TOOL_NAME);

        // Notify CLI
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.messageBus.publish({
          type: MessageBusType.PLAN_MODE_STATE_CHANGE,
          isPlanMode: false,
          planFilePath: planPath,
        });

        return {
          llmContent: [
            {
              text: `Plan approved! All tools are now available.

**Plan file:** ${planPath}

You may now proceed with implementation following the approved plan.`,
            },
          ],
          returnDisplay: 'Plan approved - implementation mode activated',
        };
      } else {
        return {
          llmContent: [
            {
              text: `Plan not approved. Reason: ${response.reason || 'User requested revisions'}

You remain in Plan Mode. Please revise your plan and call exit_plan_mode again when ready.`,
            },
          ],
          returnDisplay: `Plan not approved: ${response.reason || 'User requested revisions'}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Approval request failed: ${message}`,
        returnDisplay: `Approval failed: ${message}`,
        error: {
          message,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }

  /**
   * Request user approval via MESSAGE_BUS.
   * Returns a promise that resolves when user responds.
   */
  private async requestApproval(
    planPath: string,
    signal: AbortSignal,
  ): Promise<PlanModeApprovalResponse> {
    return new Promise((resolve, reject) => {
      const correlationId = randomUUID();
      let responseReceived = false;

      // Handle abort
      const abortHandler = () => {
        if (!responseReceived) {
          reject(new Error('Plan approval request aborted'));
        }
      };
      signal.addEventListener('abort', abortHandler);

      // Subscribe to response
      const responseHandler = (response: PlanModeApprovalResponse) => {
        if (response.correlationId === correlationId) {
          responseReceived = true;
          signal.removeEventListener('abort', abortHandler);
          this.messageBus!.unsubscribe(
            MessageBusType.PLAN_MODE_APPROVAL_RESPONSE,
            responseHandler,
          );
          resolve(response);
        }
      };

      this.messageBus!.subscribe<PlanModeApprovalResponse>(
        MessageBusType.PLAN_MODE_APPROVAL_RESPONSE,
        responseHandler,
      );

      // Publish request
      const request: PlanModeApprovalRequest = {
        type: MessageBusType.PLAN_MODE_APPROVAL_REQUEST,
        correlationId,
        planFilePath: planPath,
        planSummary: this.params.summary,
      };

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.messageBus!.publish(request);
    });
  }
}
