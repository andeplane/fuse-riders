import { useId, useState } from "react";

import type { IconName } from "../ui/icons";
import { Win98Icon } from "../ui/icons";

export type AddressBarProps = {
  address: string;
  icon: IconName;
  onSubmit: (text: string) => void;
};

/** Editable address field; the draft is transient input state until Enter. */
export function AddressBar({ address, icon, onSubmit }: AddressBarProps) {
  const id = useId();
  const [draft, setDraft] = useState(address);
  const [lastAddress, setLastAddress] = useState(address);
  if (lastAddress !== address) {
    setLastAddress(address);
    setDraft(address);
  }

  return (
    <form
      className="flex shrink-0 items-center gap-2 border-b border-[grey] px-1 py-0.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <label htmlFor={id} className="text-[11px]">
        Address
      </label>
      <div className="relative flex flex-1 items-center">
        <span className="absolute left-1">
          <Win98Icon name={icon} />
        </span>
        <input
          id={id}
          type="text"
          className="w-full pl-6"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </div>
    </form>
  );
}
