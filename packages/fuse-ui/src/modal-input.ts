export interface ModalInputDependencies {
  isOpen(): boolean;
  observe(change: () => void): () => void;
  cancel(): void;
}

/** Dialogs keep their native keys while a game's held controls are released. */
export function createModalInputGate(deps: ModalInputDependencies) {
  let open = false;
  const changed = () => {
    const next = deps.isOpen();
    if (next && !open) deps.cancel();
    open = next;
  };
  changed();
  const dispose = deps.observe(changed);
  return { blocked: () => deps.isOpen(), dispose };
}
