/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  BaseDeclarativeTool,
  Kind,
  type ToolInvocation,
  type ToolResult,
  BaseToolInvocation,
} from '../tools/tools.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { DELEGATE_TO_AGENTS_TOOL_NAME } from '../tools/tool-names.js';
import type { AgentRegistry } from './registry.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { SubagentToolWrapper } from './subagent-tool-wrapper.js';
import type { AgentInputs } from './types.js';

/**
 * Parameters for parallel agent delegation.
 */
interface DelegateToAgentsParams {
  delegations: Array<{
    agent_name: string;
    prompt: string;
  }>;
  synthesis_prompt?: string;
}

/**
 * Result from a single agent execution.
 */
interface AgentExecutionResult {
  agent_name: string;
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Tool for delegating tasks to multiple agents in parallel.
 *
 * Unlike `delegate_to_agent` which runs a single agent, this tool
 * accepts an array of delegations and executes them concurrently
 * using Promise.all(). Results are aggregated for the LLM to synthesize.
 *
 * Use cases:
 * - Multi-perspective analysis (explore + review)
 * - Comprehensive exploration (multiple areas)
 * - Parallel research tasks
 */
export class DelegateToAgentsTool extends BaseDeclarativeTool<
  DelegateToAgentsParams,
  ToolResult
> {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    const definitions = registry.getAllDefinitions();

    // Build list of available agent names for the schema
    const agentNames = definitions.map((def) => def.name);

    let schema: z.ZodTypeAny;

    if (agentNames.length === 0) {
      // Fallback if no agents are registered
      schema = z.object({
        delegations: z
          .array(
            z.object({
              agent_name: z
                .string()
                .describe('No agents are currently available.'),
              prompt: z.string().describe('The task to delegate to the agent'),
            }),
          )
          .min(1)
          .max(5)
          .describe('Array of agent delegations to execute in parallel'),
        synthesis_prompt: z
          .string()
          .optional()
          .describe(
            'Optional prompt describing how to synthesize results from all agents',
          ),
      });
    } else {
      // Create enum of valid agent names
      const agentNameEnum =
        agentNames.length === 1
          ? z.literal(agentNames[0])
          : z.enum(agentNames as [string, ...string[]]);

      schema = z.object({
        delegations: z
          .array(
            z.object({
              agent_name: agentNameEnum.describe(
                'Name of the agent to delegate to. Available agents: ' +
                  definitions
                    .map((d) => `${d.name} (${d.description})`)
                    .join(', '),
              ),
              prompt: z.string().describe('The task to delegate to this agent'),
            }),
          )
          .min(1)
          .max(5)
          .describe(
            'Array of 1-5 agent delegations to execute in parallel. Each delegation specifies an agent and its task.',
          ),
        synthesis_prompt: z
          .string()
          .optional()
          .describe(
            'Optional prompt describing how to combine/synthesize results from all agents into a unified response',
          ),
      });
    }

    super(
      DELEGATE_TO_AGENTS_TOOL_NAME,
      'Delegate to Multiple Agents (Parallel)',
      'Run multiple specialized agents simultaneously for comprehensive analysis. ' +
        'Use this tool when:\n' +
        '• You need multiple perspectives on the same problem (e.g., explore + review for thorough code analysis)\n' +
        '• You want to explore different areas of the codebase in parallel (e.g., auth module AND payment module)\n' +
        '• The task benefits from diverse expertise (e.g., plan + debug for implementation strategy)\n' +
        '• Results from independent agents can be synthesized into a unified response\n\n' +
        'Each agent runs concurrently - much faster than sequential delegation. ' +
        'Maximum 5 agents per call. Provide a synthesis_prompt to guide how results should be combined.',
      Kind.Think,
      zodToJsonSchema(schema),
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ true,
      messageBus,
    );
  }

  protected createInvocation(
    params: DelegateToAgentsParams,
  ): ToolInvocation<DelegateToAgentsParams, ToolResult> {
    return new DelegateToAgentsInvocation(
      params,
      this.registry,
      this.config,
      this.messageBus,
    );
  }
}

class DelegateToAgentsInvocation extends BaseToolInvocation<
  DelegateToAgentsParams,
  ToolResult
> {
  constructor(
    params: DelegateToAgentsParams,
    private readonly registry: AgentRegistry,
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus, DELEGATE_TO_AGENTS_TOOL_NAME);
  }

  getDescription(): string {
    const agentNames = this.params.delegations
      .map((d) => d.agent_name)
      .join(', ');
    return `Delegating to ${this.params.delegations.length} agents in parallel: [${agentNames}]`;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<ToolResult> {
    const { delegations, synthesis_prompt } = this.params;

    // Validate all agents exist before starting
    for (const delegation of delegations) {
      const definition = this.registry.getDefinition(delegation.agent_name);
      if (!definition) {
        const errorMsg = `Agent '${delegation.agent_name}' not found in registry.`;
        return {
          llmContent: `Error: ${errorMsg}`,
          returnDisplay: errorMsg,
          error: {
            message: `Agent '${delegation.agent_name}' not found`,
          },
        };
      }
    }

    // Update output to show we're starting parallel execution
    if (updateOutput) {
      updateOutput(
        `Starting ${delegations.length} agents in parallel...\n` +
          delegations.map((d) => `  - ${d.agent_name}: ${d.prompt}`).join('\n'),
      );
    }

    // Execute all delegations in parallel
    const executionPromises = delegations.map(async (delegation) => {
      const definition = this.registry.getDefinition(delegation.agent_name)!;

      try {
        const wrapper = new SubagentToolWrapper(
          definition,
          this.config,
          this.messageBus,
        );

        const invocation = wrapper.build({
          prompt: delegation.prompt,
        } as AgentInputs);
        const result = await invocation.execute(signal, (output) => {
          // Individual agent output - could be forwarded with agent prefix
          if (updateOutput) {
            const prefix = `[${delegation.agent_name}] `;
            // AnsiOutput is AnsiLine[] (array of arrays), so just use string output
            const outputStr =
              typeof output === 'string' ? output : JSON.stringify(output);
            updateOutput(prefix + outputStr.split('\n').join(`\n${prefix}`));
          }
        });

        return {
          agent_name: delegation.agent_name,
          success: !result.error,
          result:
            typeof result.llmContent === 'string'
              ? result.llmContent
              : undefined,
          error: result.error?.message,
        } as AgentExecutionResult;
      } catch (error) {
        return {
          agent_name: delegation.agent_name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        } as AgentExecutionResult;
      }
    });

    // Wait for all agents to complete
    const results = await Promise.all(executionPromises);

    // Format results for LLM
    let formattedResults = '## Parallel Agent Results\n\n';

    for (const result of results) {
      formattedResults += `### Agent: ${result.agent_name}\n`;
      if (result.success) {
        formattedResults += `**Status:** Success\n\n`;
        formattedResults += result.result || '(No output)';
      } else {
        formattedResults += `**Status:** Error\n\n`;
        formattedResults += `Error: ${result.error || 'Unknown error'}`;
      }
      formattedResults += '\n\n---\n\n';
    }

    // Add synthesis prompt if provided
    if (synthesis_prompt) {
      formattedResults += `## Synthesis Instructions\n\n${synthesis_prompt}\n`;
    }

    // Summary
    const successCount = results.filter((r) => r.success).length;
    const summary = `\n**Summary:** ${successCount}/${results.length} agents completed successfully.`;
    const fullContent = formattedResults + summary;

    return {
      llmContent: fullContent,
      returnDisplay: fullContent,
    };
  }
}
