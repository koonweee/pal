---
name: explain-agent-harness-scenarios
description: Explain Pal agent harness behavior through concrete end-to-end user scenarios, separating deterministic code behavior from model judgment. Use to align on expected flows before implementation or explain implemented flows at a higher level afterward.
---

# Explain Agent Harness Scenarios

Help the user understand what happens from their request to its visible outcome, and which parts the harness guarantees versus leaves to the model.

## Ground the explanation

- Before implementation, describe the proposed flow and label assumptions or unresolved decisions. Show where a requirement needs code enforcement or can rely on model judgment.
- After implementation, check relevant architecture, runtime code, tool configuration, and agent instructions. Describe current behavior; distinguish implemented behavior from proposals and tested scenarios from general guarantees.
- Use [architecture/backend.md](../../../architecture/backend.md) as a starting point and inspect the code for the specific flow. Keep paths and implementation details out of the explanation unless they help the user assess behavior.

## Choose concrete scenarios

Use a few short scenarios relevant to the user's question. Start with realistic user actions, such as sending an image and asking a question, requesting substantial work, following up on earlier context, or asking for a generated result. Include a failure or retry scenario when it materially changes expectations.

Follow each scenario from input through Main, a task or worker when applicable, and back to the UI or other user-visible result. Explain handoffs: what context is forwarded automatically and what the model must explicitly select or pass. Cover later lookup, persistence, or restart when relevant.

## Separate guarantees from judgment

For each scenario, use brief **Deterministic** and **Model judgment** paragraphs in the order that makes the flow easiest to follow.

- **Deterministic:** Code-enforced storage, validation, routing, tool availability, context forwarding, publication, display, limits, and retry policy. State the conditions under which the behavior occurs.
- **Model judgment:** Whether to invoke a tool, interpret content, choose or reuse a task, select context, delegate workers, choose a processing approach, produce correct work, select deliverables, or repair an error.

Keep these boundaries explicit:

- A tool being available, always on, or discovered on demand does not force the model to use it. Identify which agents have access when it matters.
- Embedded metadata or a file path provides access; content inspection still requires a read. Tool execution and model interpretation are separate steps.
- Prompt guidance expresses intended behavior. Call it a guarantee only when code enforces it.
- A deterministic retry gives feedback and another opportunity; the model chooses the correction and may fail again.
- Successful transport or publication validates delivery, not the semantic correctness of an answer or artifact.

## Keep it readable

Lead with the main division of responsibility. Use numbered scenarios and plain language, with short paragraphs. Include a small JSON or API example only when it clarifies a handoff. Mention concrete limits and failure behavior that affect the scenario. Keep the explanation scoped to the question and leave room for follow-up questions.
