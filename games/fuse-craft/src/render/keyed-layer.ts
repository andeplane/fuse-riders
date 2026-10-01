const ns = "http://www.w3.org/2000/svg";

export interface KeyedItem {
  /** Stable identity, such as a structure id or a site's owner and cell. */
  key: string;
  /** Markup for exactly one element. */
  markup: string;
}

/**
 * Keeps one element per keyed item. An item whose markup is unchanged keeps
 * its element (and its running animations); a changed item is re-parsed and
 * replaced in place; a vanished item is removed. New elements are returned but
 * not inserted: `arrangeChildren` places them.
 */
export class KeyedLayer {
  private readonly items = new Map<
    string,
    { element: Element; markup: string }
  >();

  constructor(private readonly host: SVGGElement) {}

  sync(items: readonly KeyedItem[]): Element[] {
    const seen = new Set<string>();
    const elements: Element[] = [];
    for (const item of items) {
      // Duplicate keys would share an element; keep them apart.
      let key = item.key;
      for (let n = 1; seen.has(key); n++) key = `${item.key}#${n}`;
      seen.add(key);
      const existing = this.items.get(key);
      if (existing?.markup === item.markup) {
        elements.push(existing.element);
        continue;
      }
      const element = this.parse(item.markup);
      if (existing?.element.parentNode) existing.element.replaceWith(element);
      this.items.set(key, { element, markup: item.markup });
      elements.push(element);
    }
    for (const [key, { element }] of this.items)
      if (!seen.has(key)) {
        element.remove();
        this.items.delete(key);
      }
    return elements;
  }

  private parse(markup: string): Element {
    const holder = this.host.ownerDocument.createElementNS(ns, "g");
    holder.innerHTML = markup;
    const only = holder.firstElementChild;
    return holder.childElementCount === 1 && only ? only : holder;
  }
}

/**
 * Make `host`'s children follow `order`, moving only elements that are out of
 * place. Moving a node restarts its CSS and SMIL animations, so an unchanged
 * order touches nothing. Returns how many elements were inserted or moved.
 */
export function arrangeChildren(
  host: Element,
  order: readonly Element[],
): number {
  let moves = 0;
  let cursor = host.firstElementChild;
  for (const element of order) {
    if (element === cursor) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    host.insertBefore(element, cursor);
    moves++;
  }
  return moves;
}
