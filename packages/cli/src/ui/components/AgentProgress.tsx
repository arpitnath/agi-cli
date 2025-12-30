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
 * Text color for agent labels (dark text on colored backgrounds).
 */
const AGENT_TEXT_COLOR = 'black';

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
 * AgentProgress displays real-time status of a running sub-agent.
 *
 * Styled to match Claude Code's sub-agent display:
 * - Colored background for agent name
 * - Tree structure with └─ characters
 * - Clean, professional appearance
 */
export const AgentProgress: React.FC = () => {
  const { activeAgent } = useUIState();

  if (!activeAgent) {
    return null;
  }

  const { name, displayName, status, toolCallCount, startTime } = activeAgent;

  const bgColor = AGENT_BG_COLORS[name] || 'blue';
  const displayLabel = displayName || name;
  const elapsedTime = formatElapsedTime(startTime);

  return (
    <Box flexDirection="column" marginY={0}>
      {/* Main agent line with tree structure */}
      <Box flexDirection="row">
        <Text dimColor>├─ </Text>
        <Text backgroundColor={bgColor} color={AGENT_TEXT_COLOR}>
          {` ${displayLabel} `}
        </Text>
        <Text dimColor> · </Text>
        <Text color="green">Running</Text>
      </Box>

      {/* Status line with tree continuation */}
      <Box flexDirection="row">
        <Text dimColor>│  └─ </Text>
        <CliSpinner type="dots" />
        <Text> </Text>
        <Text>{status || 'Working'}</Text>
        <Text dimColor> · {toolCallCount} tools · {elapsedTime}</Text>
      </Box>
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
