import type { AssistantAction } from "../assistant/assistantState";

import type { Y2kNotifier } from "./y2kDeps";

/**
 * Clippy's side of the millennium bug: the integrator wires this as `Y2kDeps.notify`, handing it
 * the Office Assistant's dispatch (`DesktopUiContext.assistantDispatch`). Kept apart from the
 * provider so the sequence itself never depends on the assistant.
 */
export function createAssistantY2kNotifier(
  dispatch: (action: AssistantAction) => void,
): Y2kNotifier {
  return (text) => dispatch({ type: "notice", text, mood: "sorry" });
}
