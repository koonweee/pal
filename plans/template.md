# Plan Title

## Status

Planned

## Goal

State the concrete application or user outcome and the scope of this plan.

## Current Behavior

- Describe the relevant implementation and constraints.
- Reference the files and contracts the work builds on.

## Target Data Shape

Describe affected database records, API models, or events. Link to existing contracts where possible. Omit this section when it does not apply.

## Milestones

### 1. Milestone Name

Implementation tasks:

- Define the smallest coherent implementation slice, including migrations where needed.

Exit criteria:

- State observable behavior and the validation needed to consider this milestone complete.

### 2. Milestone Name

Implementation tasks:

- Define the next implementation slice.

Exit criteria:

- State what must work before proceeding.

## Tests

- Specify the smallest useful set of tests for essential behavior.
- Reuse integration coverage across layers; add targeted regression cases for actual bugs.

## Validation Commands

List commands relevant to this plan. Identify commands the implementation must add.

```bash
cd backend
npm run build
npm run lint
npm test
npm run test:e2e
```

## Overall Exit Criteria

- State the end-to-end acceptance criteria.
- Include data and API invariants and required validation results.
