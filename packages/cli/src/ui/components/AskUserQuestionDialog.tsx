/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { Question, QuestionOption } from '@google/gemini-cli-core';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import type { DescriptiveRadioSelectItem } from './shared/DescriptiveRadioButtonSelect.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { useSelectionList } from '../hooks/useSelectionList.js';

export interface AskUserQuestionDialogProps {
  questions: Question[];
  onComplete: (answers: Record<string, string | string[]>) => void;
  isFocused?: boolean;
}

interface ExtendedOption extends QuestionOption {
  value: string;
}

export const AskUserQuestionDialog: React.FC<AskUserQuestionDialogProps> = ({
  questions,
  onComplete,
  isFocused = true,
}) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [customInputValue, setCustomInputValue] = useState('');
  const [selectedMultiOptions, setSelectedMultiOptions] = useState<Set<string>>(
    new Set(),
  );

  // Use refs to avoid recreating callbacks on every keystroke
  const customInputRef = useRef(customInputValue);
  const answersRef = useRef(answers);

  // Keep refs in sync with state
  useEffect(() => {
    customInputRef.current = customInputValue;
  }, [customInputValue]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const currentQuestion = questions[currentQuestionIndex];
  const questionId = `question_${currentQuestionIndex + 1}`;
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  // Prepare options with "Other" appended
  const optionsWithOther: ExtendedOption[] = [
    ...currentQuestion.options.map((opt: QuestionOption) => ({
      ...opt,
      value: opt.label,
    })),
    {
      label: 'Other',
      description: 'Provide custom input',
      value: 'Other',
    },
  ];

  // Convert to DescriptiveRadioSelectItem format
  const radioItems: Array<DescriptiveRadioSelectItem<string>> =
    optionsWithOther.map((opt: ExtendedOption, index: number) => ({
      key: `option-${index}`,
      title: opt.label,
      description: opt.description,
      value: opt.value,
    }));

  // Use headless hook for multi-select keyboard navigation
  const handleMultiSelectItemSelect = useCallback((value: string) => {
    if (value === 'Other') {
      setShowOtherInput(true);
      setCustomInputValue('');
    }
  }, []);

  const { activeIndex: multiSelectActiveIndex } = useSelectionList({
    items: radioItems,
    onSelect: handleMultiSelectItemSelect,
    isFocused:
      currentQuestion.multiSelect === true && !showOtherInput && isFocused,
    showNumbers: false,
  });

  const handleSingleSelection = (value: string) => {
    if (value === 'Other') {
      setShowOtherInput(true);
      setCustomInputValue('');
      return;
    }

    // Record answer
    const newAnswers = { ...answers, [questionId]: value };
    setAnswers(newAnswers);

    // Move to next question or complete
    if (isLastQuestion) {
      onComplete(newAnswers);
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setShowOtherInput(false);
    }
  };

  const handleCustomInputKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'escape') {
        // Cancel custom input, go back to options
        setShowOtherInput(false);
        setCustomInputValue('');
        return;
      }

      if (key.name === 'return') {
        // Submit custom input - use ref for current value
        const currentValue = customInputRef.current;
        if (currentValue.trim()) {
          const newAnswers = {
            ...answersRef.current,
            [questionId]: currentValue,
          };
          setAnswers(newAnswers);

          if (isLastQuestion) {
            onComplete(newAnswers);
          } else {
            setCurrentQuestionIndex((prev) => prev + 1);
            setShowOtherInput(false);
            setCustomInputValue('');
          }
        }
        return;
      }

      if (key.name === 'backspace') {
        setCustomInputValue((prev) => prev.slice(0, -1));
        return;
      }

      // Regular character input
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setCustomInputValue((prev) => prev + key.sequence);
      }
    },
    [questionId, isLastQuestion, onComplete],
  );

  const handleMultiSelectToggle = useCallback(() => {
    const highlightedItem = radioItems[multiSelectActiveIndex];
    if (!highlightedItem) return;

    const value = highlightedItem.value;
    const newSelected = new Set(selectedMultiOptions);
    if (newSelected.has(value)) {
      newSelected.delete(value);
    } else {
      newSelected.add(value);
    }
    setSelectedMultiOptions(newSelected);
  }, [radioItems, multiSelectActiveIndex, selectedMultiOptions]);

  const handleMultiSelectConfirm = useCallback(() => {
    if (selectedMultiOptions.size === 0) {
      // Require at least one selection
      return;
    }

    const selectedArray = Array.from(selectedMultiOptions);
    const newAnswers = { ...answers, [questionId]: selectedArray };
    setAnswers(newAnswers);

    if (isLastQuestion) {
      onComplete(newAnswers);
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedMultiOptions(new Set());
      setShowOtherInput(false);
    }
  }, [
    selectedMultiOptions,
    answers,
    questionId,
    isLastQuestion,
    onComplete,
    currentQuestionIndex,
  ]);

  const handleMultiSelectKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'space') {
        handleMultiSelectToggle();
        return;
      }

      if (key.name === 'return') {
        handleMultiSelectConfirm();
        return;
      }
    },
    [handleMultiSelectToggle, handleMultiSelectConfirm],
  );

  // Activate custom input keypress handler when showing other input
  useKeypress(handleCustomInputKeypress, {
    isActive: showOtherInput && isFocused,
  });

  // Activate multi-select keypress handler when in multi-select mode
  useKeypress(handleMultiSelectKeypress, {
    isActive:
      currentQuestion.multiSelect === true && !showOtherInput && isFocused,
  });

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={theme.ui.symbol}
    >
      {/* Header chip */}
      <Box marginBottom={1}>
        <Text bold color={theme.ui.symbol}>
          [{currentQuestion.header}]
        </Text>
        <Text dimColor>
          {' '}
          Question {currentQuestionIndex + 1} of {questions.length}
        </Text>
      </Box>

      {/* Question text */}
      <Box marginBottom={1}>
        <Text>{currentQuestion.question}</Text>
      </Box>

      {/* Input area */}
      {showOtherInput ? (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            Enter custom input (Esc to cancel):
          </Text>
          <Box marginTop={1}>
            <Text>{customInputValue}</Text>
            <Text inverse> </Text>
          </Box>
          {customInputValue.trim() && (
            <Text color={theme.text.secondary}>(Press Enter to submit)</Text>
          )}
        </Box>
      ) : currentQuestion.multiSelect ? (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            Select one or more options (↑/↓ to navigate, Space to toggle, Enter
            to confirm):
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {radioItems.map((item, index) => {
              const isSelected = selectedMultiOptions.has(item.value);
              const isHighlighted = index === multiSelectActiveIndex;
              const checkbox = isSelected ? '[x]' : '[ ]';
              const pointer = isHighlighted ? '>' : ' ';

              return (
                <Box
                  key={item.key}
                  flexDirection="column"
                  marginBottom={index < radioItems.length - 1 ? 1 : 0}
                >
                  <Text>
                    <Text color={isHighlighted ? theme.ui.symbol : undefined}>
                      {pointer}
                    </Text>
                    <Text color={theme.ui.symbol}>{checkbox}</Text>{' '}
                    <Text
                      bold={isSelected || isHighlighted}
                      color={isHighlighted ? theme.ui.symbol : undefined}
                    >
                      {item.title}
                    </Text>
                  </Text>
                  <Text color={theme.text.secondary}> {item.description}</Text>
                </Box>
              );
            })}
          </Box>
          {selectedMultiOptions.size > 0 && (
            <Text color={theme.text.secondary}>
              {selectedMultiOptions.size} selected (Press Enter to confirm)
            </Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.text.secondary}>
            Select an option (↑/↓ to navigate, Enter to select):
          </Text>
          <DescriptiveRadioButtonSelect
            items={radioItems}
            onSelect={handleSingleSelection}
            isFocused={isFocused}
            showNumbers={true}
          />
        </Box>
      )}
    </Box>
  );
};
