/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type FunctionCall } from '@google/genai';

export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  TOOL_EXECUTION_SUCCESS = 'tool-execution-success',
  TOOL_EXECUTION_FAILURE = 'tool-execution-failure',
  UPDATE_POLICY = 'update-policy',
  HOOK_EXECUTION_REQUEST = 'hook-execution-request',
  HOOK_EXECUTION_RESPONSE = 'hook-execution-response',
  HOOK_POLICY_DECISION = 'hook-policy-decision',
  ASK_USER_QUESTION_REQUEST = 'ask-user-question-request',
  ASK_USER_QUESTION_RESPONSE = 'ask-user-question-response',
  PLAN_MODE_STATE_CHANGE = 'plan-mode-state-change',
  PLAN_MODE_APPROVAL_REQUEST = 'plan-mode-approval-request',
  PLAN_MODE_APPROVAL_RESPONSE = 'plan-mode-approval-response',
  // Agent progress events
  AGENT_PROGRESS_START = 'agent-progress-start',
  AGENT_PROGRESS_UPDATE = 'agent-progress-update',
  AGENT_PROGRESS_COMPLETE = 'agent-progress-complete',
}

export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string;
}

export interface ToolConfirmationResponse {
  type: MessageBusType.TOOL_CONFIRMATION_RESPONSE;
  correlationId: string;
  confirmed: boolean;
  /**
   * When true, indicates that policy decision was ASK_USER and the tool should
   * show its legacy confirmation UI instead of auto-proceeding.
   */
  requiresUserConfirmation?: boolean;
}

export interface UpdatePolicy {
  type: MessageBusType.UPDATE_POLICY;
  toolName: string;
  persist?: boolean;
  argsPattern?: string;
  commandPrefix?: string | string[];
  mcpName?: string;
}

export interface ToolPolicyRejection {
  type: MessageBusType.TOOL_POLICY_REJECTION;
  toolCall: FunctionCall;
}

export interface ToolExecutionSuccess<T = unknown> {
  type: MessageBusType.TOOL_EXECUTION_SUCCESS;
  toolCall: FunctionCall;
  result: T;
}

export interface ToolExecutionFailure<E = Error> {
  type: MessageBusType.TOOL_EXECUTION_FAILURE;
  toolCall: FunctionCall;
  error: E;
}

export interface HookExecutionRequest {
  type: MessageBusType.HOOK_EXECUTION_REQUEST;
  eventName: string;
  input: Record<string, unknown>;
  correlationId: string;
}

export interface HookExecutionResponse {
  type: MessageBusType.HOOK_EXECUTION_RESPONSE;
  correlationId: string;
  success: boolean;
  output?: Record<string, unknown>;
  error?: Error;
}

export interface HookPolicyDecision {
  type: MessageBusType.HOOK_POLICY_DECISION;
  eventName: string;
  hookSource: 'project' | 'user' | 'system' | 'extension';
  decision: 'allow' | 'deny';
  reason?: string;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionRequest {
  type: MessageBusType.ASK_USER_QUESTION_REQUEST;
  correlationId: string;
  questions: Question[];
}

export interface AskUserQuestionResponse {
  type: MessageBusType.ASK_USER_QUESTION_RESPONSE;
  correlationId: string;
  answers: Record<string, string | string[]>;
}

export interface PlanModeStateChange {
  type: MessageBusType.PLAN_MODE_STATE_CHANGE;
  isPlanMode: boolean;
  planFilePath?: string | null;
}

export interface PlanModeApprovalRequest {
  type: MessageBusType.PLAN_MODE_APPROVAL_REQUEST;
  correlationId: string;
  planFilePath: string;
  planSummary?: string;
}

export interface PlanModeApprovalResponse {
  type: MessageBusType.PLAN_MODE_APPROVAL_RESPONSE;
  correlationId: string;
  approved: boolean;
  reason?: string;
}

/**
 * Agent progress events for real-time UI updates during sub-agent execution.
 */

export interface AgentProgressStart {
  type: MessageBusType.AGENT_PROGRESS_START;
  /** Unique ID for this agent execution */
  agentExecutionId: string;
  /** Agent name (e.g., "explore", "plan") */
  agentName: string;
  /** Display name (e.g., "Explore") */
  displayName?: string;
  /** Brief description of what the agent is doing */
  status: string;
  /** Timestamp when agent started */
  startTime: number;
}

export interface AgentProgressUpdate {
  type: MessageBusType.AGENT_PROGRESS_UPDATE;
  /** Matches the agentExecutionId from start event */
  agentExecutionId: string;
  /** Agent name */
  agentName: string;
  /** Current status message */
  status: string;
  /** Type of activity: tool_use, thinking, searching, etc. */
  activity: 'tool_use' | 'thinking' | 'searching' | 'writing' | 'other';
  /** Details about the activity (e.g., tool name, file path) */
  details?: string;
  /** Number of tool calls made so far */
  toolCallCount?: number;
  /** Current turn number */
  turnCount?: number;
  /** Files accessed so far */
  filesAccessed?: string[];
}

export interface AgentProgressComplete {
  type: MessageBusType.AGENT_PROGRESS_COMPLETE;
  /** Matches the agentExecutionId from start event */
  agentExecutionId: string;
  /** Agent name */
  agentName: string;
  /** Final status (success, error, timeout, etc.) */
  status: 'success' | 'error' | 'timeout' | 'aborted' | 'cycle_detected';
  /** Termination reason */
  terminateReason?: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Total tool calls made */
  toolCallCount: number;
  /** Total turns */
  turnCount: number;
  /** Brief result summary (for display) */
  resultSummary?: string;
}

export type Message =
  | ToolConfirmationRequest
  | ToolConfirmationResponse
  | ToolPolicyRejection
  | ToolExecutionSuccess
  | ToolExecutionFailure
  | UpdatePolicy
  | HookExecutionRequest
  | HookExecutionResponse
  | HookPolicyDecision
  | AskUserQuestionRequest
  | AskUserQuestionResponse
  | PlanModeStateChange
  | PlanModeApprovalRequest
  | PlanModeApprovalResponse
  | AgentProgressStart
  | AgentProgressUpdate
  | AgentProgressComplete;
