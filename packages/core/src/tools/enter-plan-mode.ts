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
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import { PolicyDecision } from '../policy/types.js';
import {
  ENTER_PLAN_MODE_TOOL_NAME,
  PLAN_MODE_BLOCKED_TOOLS,
  WRITE_FILE_TOOL_NAME,
} from './tool-names.js';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const DESCRIPTION = `Enter Plan Mode to explore the codebase and design an implementation plan before making changes.

In Plan Mode:
- Read-only tools are available (read_file, glob, search_file_content, web_fetch, etc.)
- Most file modifications are blocked (replace, run_shell_command)
- You CAN write to the designated plan file (auto-created or specified)

When your plan is complete, call exit_plan_mode with the path to your plan file.`;

const EnterPlanModeParamsSchema = z.object({
  reason: z
    .string()
    .optional()
    .describe('Optional reason for entering plan mode'),
  plan_file_path: z
    .string()
    .optional()
    .describe(
      'Optional path for the plan file. If not provided, one will be auto-generated.',
    ),
});

export type EnterPlanModeParams = z.infer<typeof EnterPlanModeParamsSchema>;

/**
 * Tool for entering Plan Mode - restricts to read-only tools for exploration.
 */
export class EnterPlanModeTool extends BaseDeclarativeTool<
  EnterPlanModeParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      ENTER_PLAN_MODE_TOOL_NAME,
      'Enter Plan Mode',
      DESCRIPTION,
      Kind.Think,
      zodToJsonSchema(EnterPlanModeParamsSchema),
      /* isOutputMarkdown */ false,
      /* canUpdateOutput */ false,
      messageBus,
    );
  }

  protected createInvocation(
    params: EnterPlanModeParams,
  ): EnterPlanModeInvocation {
    return new EnterPlanModeInvocation(params, this.config, this.messageBus);
  }
}

/**
 * Invocation instance for enter_plan_mode tool.
 */
class EnterPlanModeInvocation extends BaseToolInvocation<
  EnterPlanModeParams,
  ToolResult
> {
  constructor(
    params: EnterPlanModeParams,
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus, ENTER_PLAN_MODE_TOOL_NAME);
  }

  /**
   * Skip confirmation - entering plan mode is a safe operation.
   */
  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<false> {
    return false;
  }

  getDescription(): string {
    return 'Entering Plan Mode (read-only exploration)';
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    // Check if already in plan mode
    if (this.config.getIsPlanMode()) {
      const existingPlanPath = this.config.getPlanFilePath();
      return {
        llmContent: `Already in Plan Mode. ${existingPlanPath ? `Plan file: ${existingPlanPath}` : ''}\n\nContinue exploring or call exit_plan_mode when your plan is ready.`,
        returnDisplay: 'Already in Plan Mode',
      };
    }

    // Determine plan file path
    let planFilePath: string;
    if (this.params.plan_file_path) {
      planFilePath = path.isAbsolute(this.params.plan_file_path)
        ? this.params.plan_file_path
        : path.resolve(this.config.getWorkingDir(), this.params.plan_file_path);
    } else {
      // Auto-generate plan file in .gemini/plans/ directory
      const plansDir = path.join(
        this.config.getWorkingDir(),
        '.gemini',
        'plans',
      );
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      planFilePath = path.join(plansDir, `plan-${timestamp}.md`);

      // Ensure plans directory exists
      try {
        await fs.mkdir(plansDir, { recursive: true });
      } catch {
        // Directory might already exist, that's fine
      }
    }

    // Set plan mode state and plan file path
    this.config.setIsPlanMode(true);
    this.config.setPlanFilePath(planFilePath);

    // Add blocking rules to PolicyEngine for mutator tools
    const policyEngine = this.config.getPolicyEngine();
    for (const toolName of PLAN_MODE_BLOCKED_TOOLS) {
      policyEngine.addRule({
        toolName,
        decision: PolicyDecision.DENY,
        priority: 1000, // High priority to override other rules
      });
    }

    // Add ALLOW rule for write_file to the plan file path (higher priority)
    // Match both absolute and relative paths to the plan file
    const planFileName = path.basename(planFilePath);
    const escapedFileName = planFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match any path ending with the plan filename
    policyEngine.addRule({
      toolName: WRITE_FILE_TOOL_NAME,
      decision: PolicyDecision.ALLOW,
      argsPattern: new RegExp(`"file_path"\\s*:\\s*"[^"]*${escapedFileName}"`),
      priority: 1001, // Higher than DENY rule
    });

    // Notify CLI via MESSAGE_BUS
    if (this.messageBus) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.messageBus.publish({
        type: MessageBusType.PLAN_MODE_STATE_CHANGE,
        isPlanMode: true,
        planFilePath,
      });
    }

    const blockedToolsList = Array.from(PLAN_MODE_BLOCKED_TOOLS).join(', ');

    return {
      llmContent: [
        {
          text: `Plan Mode activated.

**Plan file:** ${planFilePath}
You can write your implementation plan to this file.

**Available tools:**
- read_file, read_many_files - Read file contents
- glob, search_file_content, list_directory - Search and explore
- web_fetch, google_web_search - Web research
- write_file (only to plan file) - Write your plan

**Blocked tools:** ${blockedToolsList}

Explore the codebase, design your plan, and write it to the plan file. When ready, call exit_plan_mode.`,
        },
      ],
      returnDisplay: `Plan Mode activated - plan file: ${planFilePath}`,
    };
  }
}
