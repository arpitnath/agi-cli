/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import type { DescriptiveRadioSelectItem } from './shared/DescriptiveRadioButtonSelect.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';

export interface PlanModeApprovalDialogProps {
  planFilePath: string;
  planSummary?: string;
  onComplete: (approved: boolean, reason?: string) => void;
  isFocused?: boolean;
}

export const PlanModeApprovalDialog: React.FC<PlanModeApprovalDialogProps> = ({
  planFilePath,
  planSummary,
  onComplete,
  isFocused = true,
}) => {
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');

  const options: Array<DescriptiveRadioSelectItem<string>> = [
    {
      key: 'approve',
      title: 'Approve Plan',
      description: 'Enable all tools and proceed with implementation',
      value: 'approve',
    },
    {
      key: 'revise',
      title: 'Request Revisions',
      description: 'Stay in Plan Mode and provide feedback',
      value: 'revise',
    },
  ];

  const handleSelection = useCallback(
    (value: string) => {
      if (value === 'approve') {
        onComplete(true);
      } else if (value === 'revise') {
        setShowRevisionInput(true);
        setRevisionReason('');
      }
    },
    [onComplete],
  );

  const handleRevisionKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'escape') {
        setShowRevisionInput(false);
        setRevisionReason('');
        return;
      }

      if (key.name === 'return') {
        onComplete(false, revisionReason.trim() || 'User requested revisions');
        return;
      }

      if (key.name === 'backspace') {
        setRevisionReason((prev) => prev.slice(0, -1));
        return;
      }

      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setRevisionReason((prev) => prev + key.sequence);
      }
    },
    [revisionReason, onComplete],
  );

  useKeypress(handleRevisionKeypress, {
    isActive: showRevisionInput && isFocused,
  });

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={theme.ui.symbol}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={theme.ui.symbol}>
          [Plan Approval]
        </Text>
      </Box>

      {/* Plan file info */}
      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Text bold>Plan file:</Text> {planFilePath}
        </Text>
        {planSummary && (
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>{planSummary}</Text>
          </Box>
        )}
      </Box>

      {/* Question */}
      <Box marginBottom={1}>
        <Text>
          Do you want to approve this plan and proceed with implementation?
        </Text>
      </Box>

      {/* Input area */}
      {showRevisionInput ? (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            Enter revision feedback (Esc to cancel, Enter to submit):
          </Text>
          <Box marginTop={1}>
            <Text>{revisionReason}</Text>
            <Text inverse> </Text>
          </Box>
          {!revisionReason.trim() && (
            <Text color={theme.text.secondary}>
              (Press Enter to submit without specific feedback)
            </Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            Select an option (arrow keys to navigate, Enter to select):
          </Text>
          <DescriptiveRadioButtonSelect
            items={options}
            onSelect={handleSelection}
            isFocused={isFocused}
            showNumbers={true}
          />
        </Box>
      )}
    </Box>
  );
};
