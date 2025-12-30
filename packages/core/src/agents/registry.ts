/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '../config/storage.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import type { Config } from '../config/config.js';
import type { AgentDefinition } from './types.js';
import { loadAgentsFromDirectory } from './toml-loader.js';
import { CodebaseInvestigatorAgent } from './codebase-investigator.js';
import { IntrospectionAgent } from './introspection-agent.js';
import { type z } from 'zod';
import { debugLogger } from '../utils/debugLogger.js';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_ALIAS_AUTO,
  PREVIEW_GEMINI_FLASH_MODEL,
  isPreviewModel,
} from '../config/models.js';
import type { ModelConfigAlias } from '../services/modelConfigService.js';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Built-in agent names that ship with the package.
 * These are loaded from TOML files in the built-in directory.
 */
export const BUILT_IN_AGENT_NAMES = ['explore', 'plan', 'review', 'debug'] as const;
export type BuiltInAgentName = (typeof BUILT_IN_AGENT_NAMES)[number];

/**
 * Returns the model config alias for a given agent definition.
 */
export function getModelConfigAlias<TOutput extends z.ZodTypeAny>(
  definition: AgentDefinition<TOutput>,
): string {
  return `${definition.name}-config`;
}

/**
 * Manages the discovery, loading, validation, and registration of
 * AgentDefinitions.
 */
export class AgentRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly agents = new Map<string, AgentDefinition<any>>();

  constructor(private readonly config: Config) {}

  /**
   * Discovers and loads agents.
   * Loading order (later loads override earlier):
   * 1. Built-in TOML agents (from package)
   * 2. Built-in TypeScript agents (codebase-investigator, introspection)
   * 3. User-level agents (~/.gemini/agents/)
   * 4. Project-level agents (.gemini/agents/)
   */
  async initialize(): Promise<void> {
    // Load built-in TOML agents first (lowest priority, can be overridden)
    await this.loadBuiltInTomlAgents();

    // Load built-in TypeScript agents
    this.loadBuiltInAgents();

    coreEvents.on(CoreEvent.ModelChanged, () => {
      this.refreshAgents();
    });

    if (!this.config.isAgentsEnabled()) {
      return;
    }

    // Load user-level agents: ~/.gemini/agents/
    const userAgentsDir = Storage.getUserAgentsDir();
    const userAgents = await loadAgentsFromDirectory(userAgentsDir);
    for (const error of userAgents.errors) {
      debugLogger.warn(
        `[AgentRegistry] Error loading user agent: ${error.message}`,
      );
      coreEvents.emitFeedback('error', `Agent loading error: ${error.message}`);
    }
    for (const agent of userAgents.agents) {
      this.registerAgent(agent);
    }

    // Load project-level agents: .gemini/agents/ (relative to Project Root)
    const folderTrustEnabled = this.config.getFolderTrust();
    const isTrustedFolder = this.config.isTrustedFolder();

    if (!folderTrustEnabled || isTrustedFolder) {
      const projectAgentsDir = this.config.storage.getProjectAgentsDir();
      const projectAgents = await loadAgentsFromDirectory(projectAgentsDir);
      for (const error of projectAgents.errors) {
        coreEvents.emitFeedback(
          'error',
          `Agent loading error: ${error.message}`,
        );
      }
      for (const agent of projectAgents.agents) {
        this.registerAgent(agent);
      }
    } else {
      coreEvents.emitFeedback(
        'info',
        'Skipping project agents due to untrusted folder. To enable, ensure that the project root is trusted.',
      );
    }

    if (this.config.getDebugMode()) {
      debugLogger.log(
        `[AgentRegistry] Initialized with ${this.agents.size} agents.`,
      );
    }
  }

  /**
   * Loads built-in TOML agents from the package's built-in directory.
   * These agents (explore, plan, review, debug) ship with the package
   * and can be overridden by user or project agents with the same name.
   */
  private async loadBuiltInTomlAgents(): Promise<void> {
    // Get the directory where this module is located
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const builtInDir = path.join(currentDir, 'built-in');

    const builtInAgents = await loadAgentsFromDirectory(builtInDir);

    for (const error of builtInAgents.errors) {
      // Built-in agent errors are more serious, log as warnings
      debugLogger.warn(
        `[AgentRegistry] Error loading built-in agent: ${error.message}`,
      );
    }

    for (const agent of builtInAgents.agents) {
      this.registerAgent(agent);
      if (this.config.getDebugMode()) {
        debugLogger.log(
          `[AgentRegistry] Loaded built-in agent: ${agent.name}`,
        );
      }
    }
  }

  private loadBuiltInAgents(): void {
    const investigatorSettings = this.config.getCodebaseInvestigatorSettings();
    const introspectionSettings = this.config.getIntrospectionAgentSettings();

    // Only register the agent if it's enabled in the settings.
    if (investigatorSettings?.enabled) {
      let model;
      const settingsModel = investigatorSettings.model;
      // Check if the user explicitly set a model in the settings.
      if (settingsModel && settingsModel !== GEMINI_MODEL_ALIAS_AUTO) {
        model = settingsModel;
      } else {
        // Use Preview Flash model if the main model is any of the preview models
        // If the main model is not preview model, use default pro model.
        model = isPreviewModel(this.config.getModel())
          ? PREVIEW_GEMINI_FLASH_MODEL
          : DEFAULT_GEMINI_MODEL;
      }

      const agentDef = {
        ...CodebaseInvestigatorAgent,
        modelConfig: {
          ...CodebaseInvestigatorAgent.modelConfig,
          model,
          thinkingBudget:
            investigatorSettings.thinkingBudget ??
            CodebaseInvestigatorAgent.modelConfig.thinkingBudget,
        },
        runConfig: {
          ...CodebaseInvestigatorAgent.runConfig,
          max_time_minutes:
            investigatorSettings.maxTimeMinutes ??
            CodebaseInvestigatorAgent.runConfig.max_time_minutes,
          max_turns:
            investigatorSettings.maxNumTurns ??
            CodebaseInvestigatorAgent.runConfig.max_turns,
        },
      };
      this.registerAgent(agentDef);
    }

    // Register the introspection agent if it's explicitly enabled.
    if (introspectionSettings.enabled) {
      this.registerAgent(IntrospectionAgent);
    }
  }

  private refreshAgents(): void {
    // Re-register built-in TOML agents (async but we don't wait)
    void this.loadBuiltInTomlAgents();
    // Re-register built-in TypeScript agents
    this.loadBuiltInAgents();
    // Re-register all agents to update model configs
    for (const agent of this.agents.values()) {
      this.registerAgent(agent);
    }
  }

  /**
   * Registers an agent definition. If an agent with the same name exists,
   * it will be overwritten, respecting the precedence established by the
   * initialization order.
   */
  protected registerAgent<TOutput extends z.ZodTypeAny>(
    definition: AgentDefinition<TOutput>,
  ): void {
    // Basic validation
    if (!definition.name || !definition.description) {
      debugLogger.warn(
        `[AgentRegistry] Skipping invalid agent definition. Missing name or description.`,
      );
      return;
    }

    if (this.agents.has(definition.name) && this.config.getDebugMode()) {
      debugLogger.log(`[AgentRegistry] Overriding agent '${definition.name}'`);
    }

    this.agents.set(definition.name, definition);

    // Register model config.
    // TODO(12916): Migrate sub-agents where possible to static configs.
    if (definition.kind === 'local') {
      const modelConfig = definition.modelConfig;
      let model = modelConfig.model;
      if (model === 'inherit') {
        model = this.config.getModel();
      }

      const runtimeAlias: ModelConfigAlias = {
        modelConfig: {
          model,
          generateContentConfig: {
            temperature: modelConfig.temp,
            topP: modelConfig.top_p,
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: modelConfig.thinkingBudget ?? -1,
            },
          },
        },
      };

      this.config.modelConfigService.registerRuntimeModelConfig(
        getModelConfigAlias(definition),
        runtimeAlias,
      );
    }

    // Register configured remote A2A agents.
    // TODO: Implement remote agent registration.
  }

  /**
   * Retrieves an agent definition by name.
   */
  getDefinition(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Returns all active agent definitions.
   */
  getAllDefinitions(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Returns a list of all registered agent names.
   */
  getAllAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Checks if an agent name is a built-in agent.
   */
  isBuiltInAgent(name: string): boolean {
    return (BUILT_IN_AGENT_NAMES as readonly string[]).includes(name);
  }

  /**
   * Returns built-in agents (explore, plan, review, debug).
   */
  getBuiltInAgents(): AgentDefinition[] {
    return Array.from(this.agents.values()).filter((agent) =>
      this.isBuiltInAgent(agent.name),
    );
  }

  /**
   * Returns custom agents (user-defined, not built-in).
   */
  getCustomAgents(): AgentDefinition[] {
    return Array.from(this.agents.values()).filter(
      (agent) => !this.isBuiltInAgent(agent.name),
    );
  }

  /**
   * Generates a description for the delegate_to_agent tool.
   * Unlike getDirectoryContext() which is for system prompts,
   * this is formatted for tool descriptions.
   */
  getToolDescription(): string {
    if (this.agents.size === 0) {
      return 'Delegates a task to a specialized sub-agent. No agents are currently available.';
    }

    const agentDescriptions = Array.from(this.agents.entries())
      .map(([name, def]) => `- **${name}**: ${def.description}`)
      .join('\n');

    return `Delegates a task to a specialized sub-agent.\n\nAvailable agents:\n${agentDescriptions}`;
  }

  /**
   * Generates a markdown "Phone Book" of available agents and their schemas.
   * This MUST be injected into the System Prompt of the parent agent.
   */
  getDirectoryContext(): string {
    if (this.agents.size === 0) {
      return 'No sub-agents are currently available.';
    }

    let context = '## Available Sub-Agents\n';
    context +=
      'Use `delegate_to_agent` for complex tasks requiring specialized analysis.\n\n';

    for (const [name, def] of this.agents) {
      context += `- **${name}**: ${def.description}\n`;
    }
    return context;
  }
}
