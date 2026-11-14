import { useControlPanelViewModel } from "./useControlPanelViewModel";

const ASSISTANT_FLAGS: {
  key: "showTips" | "narrate" | "animate" | "sounds";
  label: string;
}[] = [
  { key: "showTips", label: "Show tips" },
  { key: "narrate", label: "Narrate what the assistant does" },
  { key: "animate", label: "Play animations" },
  { key: "sounds", label: "Play sounds" },
];

/** Control Panel, Assistant: the Office Assistant's visibility and Options. The model picker is Phase B's (B4). */
export function AssistantApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const { assistantOptions: options } = vm;
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend>Office Assistant</legend>
        <div className="field-row">
          <input
            id="assistant-shown"
            type="checkbox"
            checked={vm.assistantShown}
            onChange={(event) => vm.setAssistantShown(event.target.checked)}
          />
          <label htmlFor="assistant-shown">Show the Office Assistant</label>
        </div>
        {ASSISTANT_FLAGS.map((flag) => (
          <div key={flag.key} className="field-row">
            <input
              id={`assistant-${flag.key}`}
              type="checkbox"
              checked={options[flag.key]}
              onChange={(event) =>
                vm.setAssistantOptions({ [flag.key]: event.target.checked })
              }
            />
            <label htmlFor={`assistant-${flag.key}`}>{flag.label}</label>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
