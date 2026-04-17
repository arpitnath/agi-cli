/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { type AgentListItem } from '../../types.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';

/**
 * Color mapping for agent sources.
 */
const SOURCE_COLORS: Record<string, string> = {
  'built-in': 'cyan',
  user: 'yellow',
  project: 'green',
};

interface AgentsListProps {
  agents: readonly AgentListItem[];
  showDescriptions: boolean;
  terminalWidth: number;
}

export const AgentsList: React.FC<AgentsListProps> = ({
  agents,
  showDescriptions,
  terminalWidth,
}) => {
  // Group agents by source
  const builtInAgents = agents.filter((a) => a.source === 'built-in');
  const userAgents = agents.filter((a) => a.source === 'user');
  const projectAgents = agents.filter((a) => a.source === 'project');

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.text.primary}>
        Available Agents:
      </Text>
      <Box height={1} />

      {builtInAgents.length > 0 && (
        <AgentGroup
          title="Built-in Agents"
          agents={builtInAgents}
          showDescriptions={showDescriptions}
          terminalWidth={terminalWidth}
          color={SOURCE_COLORS['built-in']!}
        />
      )}

      {userAgents.length > 0 && (
        <AgentGroup
          title="User Agents (~/.gemini/agents/)"
          agents={userAgents}
          showDescriptions={showDescriptions}
          terminalWidth={terminalWidth}
          color={SOURCE_COLORS['user']!}
        />
      )}

      {projectAgents.length > 0 && (
        <AgentGroup
          title="Project Agents (.gemini/agents/)"
          agents={projectAgents}
          showDescriptions={showDescriptions}
          terminalWidth={terminalWidth}
          color={SOURCE_COLORS['project']!}
        />
      )}

      {agents.length === 0 && (
        <Text color={theme.text.secondary}> No agents available</Text>
      )}

      <Box height={1} />
      <Text color={theme.text.secondary} dimColor>
        Tip: Use /agents desc to show full descriptions
      </Text>
    </Box>
  );
};

interface AgentGroupProps {
  title: string;
  agents: readonly AgentListItem[];
  showDescriptions: boolean;
  terminalWidth: number;
  color: string;
}

const AgentGroup: React.FC<AgentGroupProps> = ({
  title,
  agents,
  showDescriptions,
  terminalWidth,
  color,
}) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={color} bold>
      {title}
    </Text>
    {agents.map((agent) => (
      <Box key={agent.name} flexDirection="row" paddingLeft={2}>
        <Text color={theme.text.primary}>- </Text>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={theme.text.accent}>
              {agent.displayName || agent.name}
            </Text>
            <Text color={theme.text.secondary}>({agent.name})</Text>
            {agent.tools.length > 0 && (
              <Text color={theme.ui.symbol} dimColor>
                [{agent.tools.length} tools]
              </Text>
            )}
          </Box>
          {showDescriptions && agent.description && (
            <MarkdownDisplay
              terminalWidth={terminalWidth}
              text={agent.description}
              isPending={false}
            />
          )}
        </Box>
      </Box>
    ))}
  </Box>
);
