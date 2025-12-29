/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
} from './types.js';
import {
  WorkingMode,
  WORKING_MODE_DESCRIPTIONS,
  PLAN_MODE_BLOCKED_TOOLS,
  WRITE_FILE_TOOL_NAME,
  PolicyDecision,
  MessageBusType,
} from '@google/gemini-cli-core';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Helper to enter plan mode - shared logic for command and potentially tools.
 */
async function enterPlanMode(context: CommandContext): Promise<string> {
  const config = context.services.config;
  if (!config) {
    return 'Error: Configuration not available';
  }

  if (config.getIsPlanMode()) {
    const existingPath = config.getPlanFilePath();
    return `Already in Plan Mode${existingPath ? `. Plan file: ${existingPath}` : ''}`;
  }

  // Generate plan file path
  const plansDir = path.join(config.getWorkingDir(), '.gemini', 'plans');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const planFilePath = path.join(plansDir, `plan-${timestamp}.md`);

  // Ensure plans directory exists
  try {
    await fs.mkdir(plansDir, { recursive: true });
  } catch {
    // Directory might already exist
  }

  // Set plan mode state
  config.setIsPlanMode(true);
  config.setPlanFilePath(planFilePath);

  // Add blocking rules to PolicyEngine
  const policyEngine = config.getPolicyEngine();
  for (const toolName of PLAN_MODE_BLOCKED_TOOLS) {
    policyEngine.addRule({
      toolName,
      decision: PolicyDecision.DENY,
      priority: 1000,
    });
  }

  // Add ALLOW rule for write_file to the plan file
  const planFileName = path.basename(planFilePath);
  const escapedFileName = planFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  policyEngine.addRule({
    toolName: WRITE_FILE_TOOL_NAME,
    decision: PolicyDecision.ALLOW,
    argsPattern: new RegExp(`"file_path"\\s*:\\s*"[^"]*${escapedFileName}"`),
    priority: 1001,
  });

  // Notify CLI via MESSAGE_BUS
  const messageBus = config.getMessageBus?.();
  if (messageBus) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    messageBus.publish({
      type: MessageBusType.PLAN_MODE_STATE_CHANGE,
      isPlanMode: true,
      planFilePath,
    });
  }

  return `Plan Mode activated.\n\nPlan file: ${planFilePath}\n\nBlocked tools: ${Array.from(PLAN_MODE_BLOCKED_TOOLS).join(', ')}\n\nUse /mode default to exit plan mode.`;
}

/**
 * Helper to exit plan mode - shared logic for command.
 */
function exitPlanMode(context: CommandContext): string {
  const config = context.services.config;
  if (!config) {
    return 'Error: Configuration not available';
  }

  if (!config.getIsPlanMode()) {
    return 'Not currently in Plan Mode.';
  }

  const planFilePath = config.getPlanFilePath();

  // Disable plan mode
  config.setIsPlanMode(false);

  // Remove blocking rules from PolicyEngine
  const policyEngine = config.getPolicyEngine();
  for (const toolName of PLAN_MODE_BLOCKED_TOOLS) {
    policyEngine.removeRulesForTool(toolName);
  }
  // Also remove the ALLOW rule for write_file to plan file
  policyEngine.removeRulesForTool(WRITE_FILE_TOOL_NAME);

  // Notify CLI via MESSAGE_BUS
  const messageBus = config.getMessageBus?.();
  if (messageBus) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    messageBus.publish({
      type: MessageBusType.PLAN_MODE_STATE_CHANGE,
      isPlanMode: false,
      planFilePath,
    });
  }

  return `Exited Plan Mode. All tools are now available.${planFilePath ? `\n\nPlan file was: ${planFilePath}` : ''}`;
}

/**
 * Get the current working mode.
 */
function getCurrentMode(context: CommandContext): WorkingMode {
  const config = context.services.config;
  if (config?.getIsPlanMode()) {
    return WorkingMode.PLAN;
  }
  return WorkingMode.DEFAULT;
}

/**
 * Slash command for switching working modes.
 */
export const modeCommand: SlashCommand = {
  name: 'mode',
  altNames: ['m'],
  description: 'Switch working mode (plan, default)',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  subCommands: [
    {
      name: 'plan',
      description: 'Enter Plan Mode - read-only exploration for planning',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context) => {
        const message = await enterPlanMode(context);
        return {
          type: 'message',
          messageType: 'info',
          content: message,
        };
      },
    },
    {
      name: 'default',
      description: 'Exit to Default Mode - all tools available',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: (context) => {
        const message = exitPlanMode(context);
        return {
          type: 'message',
          messageType: 'info',
          content: message,
        };
      },
    },
  ],
  action: (context) => {
    const currentMode = getCurrentMode(context);
    const modeList = Object.entries(WORKING_MODE_DESCRIPTIONS)
      .map(
        ([mode, desc]) =>
          `  ${mode === currentMode ? '●' : '○'} ${mode}: ${desc}`,
      )
      .join('\n');

    return {
      type: 'message',
      messageType: 'info',
      content: `Current mode: ${currentMode}\n\nAvailable modes:\n${modeList}\n\nUsage: /mode <plan|default>`,
    };
  },
  completion: () => Object.values(WorkingMode),
};
