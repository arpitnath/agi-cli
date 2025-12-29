# Phase 2: Plan Mode Implementation Summary

**Date:** 2025-12-29 **Status:** Complete

---

## Overview

Plan Mode is a structured workflow where agents can explore and plan before
implementing. It provides:

- **Exploration Phase**: Read-only tools for codebase investigation
- **Plan Approval Flow**: User approves plan before implementation begins
- **Visual Feedback**: `[PLAN]` indicator in footer shows mode status

---

## New Files Created

### Core Package

| File                                         | Purpose                                             |
| -------------------------------------------- | --------------------------------------------------- |
| `packages/core/src/tools/enter-plan-mode.ts` | Tool that activates plan mode, blocks mutator tools |
| `packages/core/src/tools/exit-plan-mode.ts`  | Tool that requests user approval, re-enables tools  |

### CLI Package

| File                                                        | Purpose                        |
| ----------------------------------------------------------- | ------------------------------ |
| `packages/cli/src/ui/components/PlanModeApprovalDialog.tsx` | Dialog for approve/revise plan |

---

## Files Modified

### Core Package

| File                                          | Changes                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/core/src/tools/tool-names.ts`       | Added `PLAN_MODE_BLOCKED_TOOLS`, tool name constants                          |
| `packages/core/src/confirmation-bus/types.ts` | Added MESSAGE_BUS types for plan mode                                         |
| `packages/core/src/config/config.ts`          | Added `isPlanMode`, `planFilePath` state + getters/setters, tool registration |
| `packages/core/src/index.ts`                  | Exported new plan mode types                                                  |

### CLI Package

| File                                                | Changes                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `packages/cli/src/ui/contexts/UIStateContext.tsx`   | Added plan mode state fields                |
| `packages/cli/src/ui/contexts/UIActionsContext.tsx` | Added `handlePlanModeApprovalComplete`      |
| `packages/cli/src/ui/components/DialogManager.tsx`  | Added PlanModeApprovalDialog rendering      |
| `packages/cli/src/ui/AppContainer.tsx`              | MESSAGE_BUS subscriptions, state management |
| `packages/cli/src/ui/components/Footer.tsx`         | Added `[PLAN]` indicator                    |
| `packages/cli/src/test-utils/render.tsx`            | Added mock for new handler                  |

---

## Architecture

### Tool Blocking

Uses `PolicyEngine.addRule()` with high-priority (1000) DENY rules:

```typescript
const policyEngine = this.config.getPolicyEngine();
for (const toolName of PLAN_MODE_BLOCKED_TOOLS) {
  policyEngine.addRule({
    toolName,
    decision: PolicyDecision.DENY,
    priority: 1000,
  });
}
```

**Blocked Tools:**

- `write_file`
- `replace` (edit)
- `run_shell_command`
- `save_memory`

**Allowed Tools (read-only):**

- `read_file`, `read_many_files`
- `glob`, `search_file_content`, `list_directory`
- `web_fetch`, `google_web_search`
- `get_internal_docs`
- `enter_plan_mode`, `exit_plan_mode`

### MESSAGE_BUS Communication

Three new message types:

1. **PLAN_MODE_STATE_CHANGE**: Core → CLI, notifies mode changes
2. **PLAN_MODE_APPROVAL_REQUEST**: Core → CLI, shows approval dialog
3. **PLAN_MODE_APPROVAL_RESPONSE**: CLI → Core, returns user decision

---

## User Flow

```
1. Agent calls enter_plan_mode()
   → PolicyEngine gets DENY rules for blocked tools
   → CLI shows [PLAN] indicator
   → LLM receives "Plan Mode activated" message

2. Agent explores with read-only tools
   → Blocked tools return policy rejection

3. Agent writes plan file (using allowed tools)

4. Agent calls exit_plan_mode(plan_file_path)
   → MESSAGE_BUS sends approval request
   → CLI shows PlanModeApprovalDialog

5a. User approves
    → PolicyEngine rules removed
    → isPlanMode = false
    → LLM receives "Plan approved" message

5b. User requests revisions
    → Stay in plan mode
    → LLM receives revision feedback
```

---

## Testing

Verified:

- [x] TypeScript compilation passes (both packages)
- [x] Build succeeds (both packages)
- [ ] Manual end-to-end testing (pending)

---

## Key Design Decisions

1. **PolicyEngine over BeforeTool hooks**: Cleaner integration, consistent with
   existing tool permission architecture

2. **MESSAGE_BUS pattern**: Same pub/sub pattern as AskUserQuestion, proven
   reliable

3. **High-priority DENY rules**: Priority 1000 ensures plan mode blocks override
   user-configured allows

4. **State in Config class**: Keeps state accessible across tools, consistent
   with existing patterns like `shellModeActive`
