# Phase 1: AskUserQuestion Tool - Implementation Summary

**Date:** 2025-12-29 **Status:** ✅ Complete & Tested **Branch:**
`feat/agi-enhancements`

---

## Overview

Phase 1 adds the `ask_user_question` tool to AGI CLI, enabling agents to
interactively ask users questions during task execution. This supports
single-select, multi-select, and custom "Other" input modes.

---

## Features Implemented

### 1. Core Tool (`ask_user_question`)

- **Location:** `packages/core/src/tools/ask-user-question.ts`
- **Capabilities:**
  - Ask 1-4 questions per invocation
  - Each question has 2-4 predefined options with descriptions
  - Automatic "Other" option for custom text input
  - Multi-select mode (`multiSelect: true`) for checkbox-style selection
  - Header chips for categorization (e.g., "Auth", "Database")

### 2. Interactive Dialog UI

- **Location:** `packages/cli/src/ui/components/AskUserQuestionDialog.tsx`
- **Features:**
  - Keyboard navigation (↑/↓ arrows, j/k vim keys)
  - Single-select: Enter to select
  - Multi-select: Space to toggle, Enter to confirm
  - Custom input: Type text, Enter to submit, Esc to cancel
  - Visual feedback with pointer (`>`) and checkboxes (`[x]`/`[ ]`)
  - Theme-aware styling

### 3. MESSAGE_BUS Integration

- **Request Type:** `ASK_USER_QUESTION_REQUEST`
- **Response Type:** `ASK_USER_QUESTION_RESPONSE`
- **Flow:** Tool → MESSAGE_BUS → AppContainer → Dialog → MESSAGE_BUS → Tool

---

## Files Modified

| File                                                       | Changes                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/core/src/tools/ask-user-question.ts`             | Tool implementation with Zod validation, `shouldConfirmExecute()` override |
| `packages/core/src/tools/tool-names.ts`                    | Added `ASK_USER_QUESTION_TOOL_NAME`                                        |
| `packages/core/src/tools/index.ts`                         | Export new tool                                                            |
| `packages/core/src/confirmation-bus/types.ts`              | Added request/response MESSAGE_BUS types                                   |
| `packages/cli/src/ui/components/AskUserQuestionDialog.tsx` | New dialog component with headless hook                                    |
| `packages/cli/src/ui/AppContainer.tsx`                     | MESSAGE_BUS subscription, dialog visibility, state management              |
| `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`         | Dialog rendering integration                                               |

---

## Usage Examples

### Single Question (Single-Select)

```
User: "Ask me which database to use"

Agent calls ask_user_question:
{
  "questions": [{
    "question": "Which database should we use for this project?",
    "header": "Database",
    "options": [
      {"label": "PostgreSQL", "description": "Robust relational database"},
      {"label": "SQLite", "description": "Lightweight, file-based"},
      {"label": "MongoDB", "description": "Document-oriented NoSQL"}
    ]
  }]
}
```

### Multi-Select Question

```
Agent calls ask_user_question:
{
  "questions": [{
    "question": "Which features do you want enabled?",
    "header": "Features",
    "multiSelect": true,
    "options": [
      {"label": "Authentication", "description": "User login system"},
      {"label": "Caching", "description": "Redis-based caching"},
      {"label": "Logging", "description": "Structured logging"}
    ]
  }]
}

Response: {"answers": {"question_1": ["Authentication", "Logging"]}}
```

### Custom "Other" Input

```
User navigates to "Other" option → Types custom text → Presses Enter

Response: {"answers": {"question_1": "Custom user input here"}}
```

---

## Key Implementation Details

### 1. Tool Confirmation Bypass

The tool overrides `shouldConfirmExecute()` to return `false`, preventing the
standard tool confirmation dialog from appearing (since the tool itself is
inherently interactive).

```typescript
override async shouldConfirmExecute(_abortSignal: AbortSignal): Promise<false> {
  return false;
}
```

### 2. Dialog Visibility

The `dialogsVisible` flag in `AppContainer.tsx` must include
`askUserQuestionRequest` for the dialog to render instead of the input composer:

```typescript
const dialogsVisible =
  // ... other conditions ...
  !!askUserQuestionRequest ||
  // ...
```

### 3. Headless Hook for Multi-Select

Multi-select mode uses the `useSelectionList` headless hook for keyboard
navigation, with custom rendering for checkboxes:

```typescript
const { activeIndex } = useSelectionList({
  items: radioItems,
  onSelect: handleMultiSelectItemSelect,
  isFocused: currentQuestion.multiSelect && !showOtherInput && isFocused,
});
```

### 4. Callback Stability

Custom input handling uses refs to prevent callback recreation on every
keystroke:

```typescript
const customInputRef = useRef(customInputValue);
useEffect(() => {
  customInputRef.current = customInputValue;
}, [customInputValue]);

const handleKeypress = useCallback(
  (key) => {
    // Use customInputRef.current instead of customInputValue
  },
  [
    /* minimal dependencies */
  ],
);
```

---

## Bugs Fixed During Implementation

| Bug                                                         | Root Cause                                             | Fix                                  |
| ----------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| Tool confirmation dialog showing instead of question dialog | Missing `shouldConfirmExecute()` override              | Added override returning `false`     |
| Dialog not rendering                                        | `askUserQuestionRequest` not in `dialogsVisible` check | Added to visibility condition        |
| Custom input "stuck"/not responding                         | Callback recreated on every keystroke                  | Used refs + functional state updates |
| Header validation too strict                                | 12 char limit for headers                              | Relaxed to 20 chars                  |
| Duplicate rendering in multi-select                         | Using visual + headless components                     | Switched to headless hook only       |
| ESLint floating promise warning                             | `messageBus.publish()` not awaited                     | Added `void` operator                |

---

## Testing Results

| Test                               | Status  |
| ---------------------------------- | ------- |
| Single question with single-select | ✅ Pass |
| "Other" custom text input          | ✅ Pass |
| Multi-select with checkboxes       | ✅ Pass |
| Multiple sequential questions      | ✅ Pass |
| Keyboard navigation (↑/↓)          | ✅ Pass |
| Escape to cancel custom input      | ✅ Pass |
| Space to toggle multi-select       | ✅ Pass |

---

## Commits

1. **`1b26ea31`** - fix(cli): AskUserQuestion dialog visibility and input
   handling
   - Add askUserQuestionRequest to dialogsVisible check
   - Skip tool confirmation with shouldConfirmExecute()
   - Fix custom input callback stability using refs
   - Relax header validation from 12 to 20 chars
   - Fix floating promise and useMemo dependencies

2. **`2acfba39`** - fix(cli): remove duplicate rendering in multi-select dialog
   - Use headless useSelectionList hook for keyboard navigation
   - Remove duplicate DescriptiveRadioButtonSelect in multi-select mode
   - Add visual pointer (>) for highlighted item
   - Theme-colored highlighting for focused items

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent/LLM                                │
│                            │                                     │
│                   calls ask_user_question                        │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AskUserQuestionTool                            ││
│  │                                                             ││
│  │  1. Validates params (Zod schema)                           ││
│  │  2. Creates invocation                                      ││
│  │  3. Publishes ASK_USER_QUESTION_REQUEST                     ││
│  │  4. Awaits ASK_USER_QUESTION_RESPONSE                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                      MESSAGE_BUS                                 │
│                            │                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AppContainer.tsx                               ││
│  │                                                             ││
│  │  1. Subscribes to ASK_USER_QUESTION_REQUEST                 ││
│  │  2. Sets askUserQuestionRequest state                       ││
│  │  3. dialogsVisible becomes true                             ││
│  │  4. Renders AskUserQuestionDialog                           ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │            AskUserQuestionDialog.tsx                        ││
│  │                                                             ││
│  │  1. Renders questions sequentially                          ││
│  │  2. Handles keyboard (useKeypress, useSelectionList)        ││
│  │  3. Collects answers                                        ││
│  │  4. Calls onComplete(answers)                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                      MESSAGE_BUS                                 │
│                            │                                     │
│                 ASK_USER_QUESTION_RESPONSE                       │
│                            │                                     │
│                            ▼                                     │
│              Tool resolves with answers                          │
│                            │                                     │
│                            ▼                                     │
│                   Agent continues                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Visual Examples

### Single-Select Mode

```
┌────────────────────────────────────────────────────┐
│ [Database] Question 1 of 1                         │
│                                                    │
│ Which database should we use for this project?    │
│                                                    │
│ Select an option (↑/↓ to navigate, Enter to select):│
│                                                    │
│ › PostgreSQL                                       │
│   Robust relational database                       │
│   SQLite                                           │
│   Lightweight, file-based                          │
│   Other                                            │
│   Provide custom input                             │
└────────────────────────────────────────────────────┘
```

### Multi-Select Mode

```
┌────────────────────────────────────────────────────┐
│ [Features] Question 1 of 1                         │
│                                                    │
│ Which features do you want enabled?               │
│                                                    │
│ Select one or more (↑/↓, Space toggle, Enter confirm):│
│                                                    │
│ >[x] Authentication                                │
│      User login system                             │
│  [ ] Caching                                       │
│      Redis-based caching                           │
│  [x] Logging                                       │
│      Structured logging                            │
│                                                    │
│ 2 selected (Press Enter to confirm)               │
└────────────────────────────────────────────────────┘
```

### Custom "Other" Input Mode

```
┌────────────────────────────────────────────────────┐
│ [Language] Question 1 of 1                         │
│                                                    │
│ Which programming language do you prefer?         │
│                                                    │
│ Enter custom input (Esc to cancel):               │
│ Rust█                                              │
│ (Press Enter to submit)                           │
└────────────────────────────────────────────────────┘
```

---

## Summary

Phase 1 is **complete and fully functional**. The `ask_user_question` tool
enables:

- **Human-in-the-loop workflows** - Agents can pause and ask for user input
- **Preference gathering** - Collect implementation choices before proceeding
- **Clarification requests** - Resolve ambiguous instructions mid-task
- **Multi-select decisions** - Enable selecting multiple options (features,
  configs)

All three input modes (single-select, multi-select, custom text) are working and
tested.

---

_Ready for Phase 2 (Plan Mode + Example Routing) when approved._
