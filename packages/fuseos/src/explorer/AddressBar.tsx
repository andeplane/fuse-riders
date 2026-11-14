import { useId, useRef, useState } from "react";

import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuPosition } from "../windows/menuPosition";

export type AddressPlace = { label: string; onSelect: () => void };

export type AddressBarProps = {
  address: string;
  icon: IconName;
  onSubmit: (text: string) => void;
  /** The drop-down's list: the Desktop, My Computer, the drives and the way down to this folder. */
  places: AddressPlace[];
};

/** The Address band: a combo box with the place's icon; the draft is transient input state until Enter. */
export function AddressBar({
  address,
  icon,
  onSubmit,
  places,
}: AddressBarProps) {
  const id = useId();
  const comboRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(address);
  const [lastAddress, setLastAddress] = useState(address);
  const [menu, setMenu] = useState<MenuPosition | undefined>(undefined);
  if (lastAddress !== address) {
    setLastAddress(address);
    setDraft(address);
  }

  return (
    <form
      className="explorer-address"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <label htmlFor={id} className="explorer-address-label">
        Address
      </label>
      <div ref={comboRef} className="explorer-address-combo">
        <Win98Icon name={icon} />
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
        <button
          type="button"
          className="explorer-address-drop"
          aria-label="Address list"
          aria-haspopup="menu"
          aria-expanded={menu !== undefined}
          onClick={(event) => {
            const rect = (
              comboRef.current ?? event.currentTarget
            ).getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom });
          }}
        />
      </div>
      {menu ? (
        <ContextMenu
          label="Address list"
          position={menu}
          items={places}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
    </form>
  );
}
