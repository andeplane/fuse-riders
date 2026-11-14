export function createDom(document: Document) {
  function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = "",
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(
    text: string,
    action: () => void,
    className = "",
  ): HTMLButtonElement {
    const element = node("button", className, text);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }

  function field(label: string, control: HTMLElement): HTMLLabelElement {
    const element = node("label", "field");
    element.append(node("span", "field-label", label), control);
    return element;
  }

  function select(
    options: readonly (readonly [string, string])[],
    value: string,
  ): HTMLSelectElement {
    const element = node("select");
    for (const [key, text] of options) {
      const option = node("option", "", text);
      option.value = key;
      element.append(option);
    }
    element.value = value;
    return element;
  }
  return { node, button, field, select };
}
export type Dom = ReturnType<typeof createDom>;
