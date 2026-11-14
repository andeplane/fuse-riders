import type { AssistantAction } from "../assistant/assistantState";

import { createAssistantY2kNotifier } from "./assistantNotifier";
import { Y2K_CLIPPY_LINE } from "./y2kSequence";

describe(createAssistantY2kNotifier.name, () => {
  it("turns the line into an apologetic notice for the Office Assistant", () => {
    const actions: AssistantAction[] = [];
    const notify = createAssistantY2kNotifier((action) => actions.push(action));
    notify(Y2K_CLIPPY_LINE);
    expect(actions).toEqual([
      { type: "notice", text: Y2K_CLIPPY_LINE, mood: "sorry" },
    ]);
  });
});
