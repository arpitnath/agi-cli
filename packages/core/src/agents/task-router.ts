/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILT_IN_AGENT_NAMES, type BuiltInAgentName } from './registry.js';

/**
 * Routing patterns for built-in agents.
 * Each agent has a set of regex patterns that match user prompts.
 * The first matching agent wins (order matters for overlapping patterns).
 */
const ROUTING_PATTERNS: Map<BuiltInAgentName, RegExp[]> = new Map([
  [
    'explore',
    [
      // Direct exploration keywords
      /\b(find|locate|search|where|look for|show me)\b/i,
      // Questions about files or code
      /\b(what|which) (files?|code|implementation|module)/i,
      // Explicit explore command
      /\bexplore\b/i,
      // Understanding structure
      /\b(how is|how does|structure of|layout of)\b.*\b(organized|structured)\b/i,
      // Finding specific things
      /\b(where|which file|what file).*\b(is|are|contains?|has|have)\b/i,
      // Understanding/explaining code
      /\b(explain|understand|describe|tell me about)\b.*\b(code|codebase|project|architecture|system)\b/i,
      // How does X work questions
      /\bhow does\b.*\b(work|function|operate)\b/i,
      // What is X questions about code concepts
      /\bwhat is\b.*\b(the|this)\b.*\b(code|module|component|service|class|function)\b/i,
      // Give me an overview
      /\b(overview|summary|walkthrough)\b.*\b(of|the)\b/i,
    ],
  ],
  [
    'plan',
    [
      // Planning and design keywords
      /\b(plan|design|architect|outline|strategy|approach)\b/i,
      // Implementation questions
      /\bhow (should|would|can|do) (i|we|you)\b.*\b(implement|build|create|add)\b/i,
      // Feature design
      /\b(implement(ation)?|feature) (plan|design|approach)\b/i,
      // Step-by-step requests
      /\b(steps?|breakdown|roadmap) (to|for)\b/i,
    ],
  ],
  [
    'review',
    [
      // Code review keywords
      /\b(review|audit|check|analyze|critique) (the |this |my )?(code|changes?|PR|pull request|diff)\b/i,
      // Quality concerns
      /\b(security|performance|quality|best practices?) (review|check|audit|issue)/i,
      // Looking for problems
      /\b(find|look for|check for) (bugs?|issues?|problems?|vulnerabilities)\b/i,
      // Code quality
      /\b(is this|does this|could this) (code )?(good|bad|safe|secure|efficient)\b/i,
    ],
  ],
  [
    'debug',
    [
      // Debugging keywords
      /\b(debug|troubleshoot|diagnose)\b/i,
      // Error investigation
      /\b(why|what|how) (is|does|did) (this|it|the).*\b(fail|error|crash|break|not work)\b/i,
      // Bug-related
      /\b(fix|solve|resolve) (this |the |a )?(bug|issue|problem|error)\b/i,
      // Error messages
      /\b(error|exception|stack trace|traceback|failing|broken)\b/i,
      // Investigation
      /\b(investigate|figure out|understand why)\b/i,
      // Not working
      /\b(doesn't|does not|isn't|is not|won't|will not) (work|run|compile|build)\b/i,
    ],
  ],
]);

/**
 * Result of routing analysis, including the selected agent and why.
 */
export interface RoutingResult {
  /** The agent to route to, or null if no match */
  agent: BuiltInAgentName | null;
  /** The pattern that matched (for debugging/display) */
  matchedPattern?: string;
  /** Confidence level based on match specificity */
  confidence: 'high' | 'medium' | 'low' | 'none';
}

/**
 * Analyzes a user prompt and determines which built-in agent to route to.
 *
 * @param prompt The user's input prompt
 * @returns The name of the agent to route to, or null if no match
 */
export function routeToAgent(prompt: string): BuiltInAgentName | null {
  const result = analyzePrompt(prompt);
  return result.agent;
}

/**
 * Analyzes a prompt and returns detailed routing information.
 *
 * @param prompt The user's input prompt
 * @returns Detailed routing result with agent, matched pattern, and confidence
 */
export function analyzePrompt(prompt: string): RoutingResult {
  // Check each agent's patterns in priority order
  for (const agentName of BUILT_IN_AGENT_NAMES) {
    const patterns = ROUTING_PATTERNS.get(agentName);
    if (!patterns) continue;

    for (const pattern of patterns) {
      if (pattern.test(prompt)) {
        return {
          agent: agentName,
          matchedPattern: pattern.source,
          confidence: determineConfidence(prompt, pattern),
        };
      }
    }
  }

  return {
    agent: null,
    confidence: 'none',
  };
}

/**
 * Determines confidence level based on how specific the match is.
 */
function determineConfidence(
  prompt: string,
  pattern: RegExp,
): 'high' | 'medium' | 'low' {
  const match = prompt.match(pattern);
  if (!match) return 'low';

  // Longer matches = higher confidence
  const matchLength = match[0].length;
  const promptLength = prompt.length;
  const ratio = matchLength / promptLength;

  if (ratio > 0.3) return 'high';
  if (ratio > 0.15) return 'medium';
  return 'low';
}

/**
 * Returns a human-readable explanation of why an agent was selected.
 *
 * @param result The routing result
 * @returns A user-friendly explanation string
 */
export function explainRouting(result: RoutingResult): string {
  if (!result.agent) {
    return 'No specific agent matched. Using default behavior.';
  }

  const agentDescriptions: Record<BuiltInAgentName, string> = {
    explore: 'searching and exploring the codebase',
    plan: 'designing an implementation approach',
    review: 'reviewing code quality and security',
    debug: 'investigating bugs and errors',
  };

  const description = agentDescriptions[result.agent];
  const confidenceText =
    result.confidence === 'high'
      ? 'strongly'
      : result.confidence === 'medium'
        ? 'likely'
        : 'possibly';

  return `Selected [${result.agent}] (${confidenceText} matched for ${description})`;
}

/**
 * Checks if an agent name is a valid built-in agent.
 */
export function isBuiltInAgentName(name: string): name is BuiltInAgentName {
  return (BUILT_IN_AGENT_NAMES as readonly string[]).includes(name);
}
