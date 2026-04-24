# Kone V1.2 Multi-Agent Anti-Regression Protocol

This repository uses Oh My OpenCode Flow Engineering as a mandatory working model for non-trivial changes.

## Scope Guard

- This baseline task only configures AI agent workflow and test scaffolding.
- Do not modify business code under `electron/` or `src/` unless a later task explicitly requires it.

## Mandatory Document Chain

Before analyzing, planning, or modifying existing logic, every agent must read these 7 documents in order:

1. `PROJECT-PRD.md`
2. `ARCH-STANDARDS.md`
3. `.opencode/agents/ui-agent.md`
4. `.opencode/agents/ipc-agent.md`
5. `.opencode/agents/system-blueprint.md`
6. `.opencode/agents/build-agent.md`
7. `V1.2-商业版交付与运维手册.md`
8. `.clinerules`

Skipping any document in this chain is a protocol violation.

## Plan-First Rule

- Any task touching more than 1 file or involving complex business logic must start with Prometheus, the planning agent.
- Prometheus must output a concrete execution checklist before any code or configuration is changed.
- Direct implementation without a planning pass is forbidden for multi-file or complex work.

## Multi-Agent Collaboration Rule

- Prometheus owns planning and decomposition.
- Specialized agents execute only after the plan is approved by workflow order.
- Execution must follow the checklist sequence and keep changes scoped to the stated task.
- If new risk appears during execution, stop implementation, update the plan, and continue only from the revised checklist.

## Anti-Regression Protocol

- Read the full 7-document chain before changing existing logic.
- Preserve all validated behavior, especially the mandatory `三级降级链路`.
- Never fix a new bug by breaking a previously working path.
- Any change that may affect existing logic must be verified with local test scripts after modification.
- A task is not complete until the relevant local verification passes.

## Test Discipline

- Use local test scripts defined in `package.json` as the required verification entrypoints.
- Prefer `node --test` based execution for scripts under `tests/`.
- Add or extend tests under `tests/` and `tests/e2e/` when workflow coverage needs to grow.

## Change Safety

- Default to the smallest safe change.
- Do not expand scope from workflow/configuration tasks into product code.
- Keep repository rules, billing boundaries, and fallback resilience guarantees intact.
