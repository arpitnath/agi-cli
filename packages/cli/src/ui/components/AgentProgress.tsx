/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { CliSpinner } from './CliSpinner.js';
import { useUIState } from '../contexts/UIStateContext.js';

/**
 * Background color mapping for different agent types.
 * Each agent has a distinctive background color for quick visual identification.
 * Matches Claude Code's sub-agent styling.
 */
const AGENT_BG_COLORS: Record<string, string> = {
  explore: 'cyan',
  plan: 'yellow',
  review: 'magenta',
  debug: 'red',
};

/**
 * Formats elapsed time in a human-readable format.
 */
function formatElapsedTime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) {
    return `${elapsed}s`;
  }
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * AgentProgress displays real-time status of running sub-agents.
 *
 * Supports multiple concurrent agents with a tree-style display:
 * ```
 * Running 2 agents... (esc to cancel)
 * ├─ Explore · Running
 * │  └─ ⠋ Searching for files · 0 tools · 5s
 * └─ Review · Running
 *    └─ ⠋ Analyzing patterns · 0 tools · 5s
 * ```
 *
 * Styled to match Claude Code's sub-agent display:
 * - Colored background for agent name with white text for contrast
 * - Tree structure with ├─/└─ characters
 * - Header showing agent count
 */
export const AgentProgress: React.FC = () => {
  const { activeAgents } = useUIState();

  if (activeAgents.size === 0) {
    return null;
  }

  const agents = Array.from(activeAgents.values());

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Header line showing agent count */}
      <Box flexDirection="row">
        <Text>Running </Text>
        <Text bold>{agents.length}</Text>
        <Text> agent{agents.length > 1 ? 's' : ''}...</Text>
        <Text dimColor> (esc to cancel)</Text>
      </Box>

      {/* Agent list with tree structure */}
      {agents.map((agent, index) => {
        const isLast = index === agents.length - 1;
        const bgColor = AGENT_BG_COLORS[agent.name] || 'blue';
        const elapsedTime = formatElapsedTime(agent.startTime);
        const displayLabel = agent.displayName || agent.name;

        return (
          <Box key={agent.executionId} flexDirection="column">
            {/* Main agent line */}
            <Box flexDirection="row">
              <Text dimColor>{isLast ? '└─ ' : '├─ '}</Text>
              <Text backgroundColor={bgColor} color="white" bold>
                {` ${displayLabel} `}
              </Text>
              <Text dimColor> · </Text>
              <Text color="green">Running</Text>
            </Box>

            {/* Status line with tree continuation */}
            <Box flexDirection="row">
              <Text dimColor>{isLast ? '   └─ ' : '│  └─ '}</Text>
              <CliSpinner type="dots" />
              <Text> </Text>
              <Text>{agent.status || 'Working'}</Text>
              <Text dimColor>
                {' '}
                · {agent.toolCallCount} tools · {elapsedTime}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Formats the list of files accessed, showing abbreviated paths.
 */
export function formatFilesAccessed(files: string[]): string {
  const maxFiles = 3;
  const abbreviated = files.slice(-maxFiles).map(abbreviatePath);

  if (files.length > maxFiles) {
    return `...${abbreviated.join(', ')}`;
  }
  return abbreviated.join(', ');
}

/**
 * Abbreviates a file path to show just the filename.
 */
function abbreviatePath(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}
