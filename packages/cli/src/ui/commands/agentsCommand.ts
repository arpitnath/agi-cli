/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import {
  MessageType,
  type HistoryItemAgentsList,
  type AgentListItem,
} from '../types.js';

export const agentsCommand: SlashCommand = {
  name: 'agents',
  description: 'List available agents. Usage: /agents [desc]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args?: string): Promise<void> => {
    const subCommand = args?.trim();

    // Default to NOT showing descriptions. The user must opt in with an argument.
    let showDescriptions = false;
    if (subCommand === 'desc' || subCommand === 'descriptions') {
      showDescriptions = true;
    }

    const agentRegistry = context.services.config?.getAgentRegistry();
    if (!agentRegistry) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Could not retrieve agent registry.',
        },
        Date.now(),
      );
      return;
    }

    // Get all agents and map to display format
    const allAgents = agentRegistry.getAllDefinitions();
    const builtInAgentNames = new Set(
      agentRegistry.getBuiltInAgents().map((a) => a.name),
    );

    const agentItems: AgentListItem[] = allAgents.map((agent) => {
      let source: 'built-in' | 'user' | 'project' = 'project';

      if (builtInAgentNames.has(agent.name)) {
        source = 'built-in';
      }
      // Note: For now, we mark all non-built-in as 'project'
      // Future: detect user vs project from file path when that info is available

      // Extract tool names from toolConfig
      let toolNames: string[] = [];
      if (agent.kind === 'local' && agent.toolConfig?.tools) {
        toolNames = agent.toolConfig.tools
          .map((tool) => {
            if (typeof tool === 'string') {
              return tool;
            } else if ('name' in tool && typeof tool.name === 'string') {
              return tool.name;
            }
            return undefined;
          })
          .filter((name): name is string => name !== undefined);
      }

      return {
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        source,
        tools: toolNames,
      };
    });

    const agentsListItem: HistoryItemAgentsList = {
      type: MessageType.AGENTS_LIST,
      agents: agentItems,
      showDescriptions,
    };

    context.ui.addItem(agentsListItem, Date.now());
  },
};
