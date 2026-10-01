/** Update text and attributes without replacing focused controls on each simulation frame. */
export function updateContent(target: Element, markup: string): void {
  const template = target.ownerDocument.createElement("template");
  template.innerHTML = markup;
  reconcile(target, template.content);
}
function key(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const element = node as Element;
  return (
    element.id ||
    element.getAttribute("data-action") ||
    element.getAttribute("data-field")
  );
}
function compatible(a: Node, b: Node): boolean {
  return (
    a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b)
  );
}
function reconcile(target: Node, source: Node): void {
  let cursor: Node | null = target.firstChild;
  for (const desired of Array.from(source.childNodes)) {
    let current: Node | null = cursor;
    if (!current || !compatible(current, desired)) {
      const match = key(desired)
        ? Array.from(target.childNodes).find((n) => compatible(n, desired))
        : undefined;
      if (match) {
        target.insertBefore(match, cursor);
        current = match;
      } else {
        current = desired.cloneNode(true);
        target.insertBefore(current, cursor);
        cursor = current.nextSibling;
        continue;
      }
    }
    if (current.nodeType === 1) {
      const old = current as Element,
        next = desired as Element;
      const previousValue = old.getAttribute("value");
      for (const attribute of Array.from(old.attributes))
        if (!next.hasAttribute(attribute.name))
          old.removeAttribute(attribute.name);
      for (const attribute of Array.from(next.attributes))
        if (old.getAttribute(attribute.name) !== attribute.value)
          old.setAttribute(attribute.name, attribute.value);
      // A browser keeps a user-edited input's live value separate from its
      // value attribute. Update it when the authoritative value changes,
      // while leaving an in-progress drag alone between identical snapshots.
      if (
        old.tagName.toLowerCase() === "input" &&
        previousValue !== next.getAttribute("value")
      )
        (old as HTMLInputElement).value = next.getAttribute("value") ?? "";
      reconcile(current, desired);
    } else if (current.nodeValue !== desired.nodeValue)
      current.nodeValue = desired.nodeValue;
    cursor = current.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    target.removeChild(cursor);
    cursor = next;
  }
}
