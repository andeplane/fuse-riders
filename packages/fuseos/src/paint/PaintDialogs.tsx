import type { ReactNode } from "react";
import { useState } from "react";

import { matchShortcut } from "../lib/shortcuts";
import { Win98Icon } from "../ui/icons";

import type { ImageMimeType } from "./paintTools";
import { fileNameFor } from "./paintTools";

/** A modal Win98 dialog box drawn over the Paint window body. */
export function PaintModal({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
      data-testid="paint-modal"
    >
      <section
        role="dialog"
        aria-label={title}
        aria-modal="true"
        className="window flex max-h-full w-[420px] max-w-full flex-col"
      >
        <header className="title-bar">
          <div className="title-bar-text">{title}</div>
        </header>
        <div className="window-body flex min-h-0 flex-col gap-3">
          {children}
        </div>
      </section>
    </div>
  );
}

export type ConfirmDialogProps = {
  title: string;
  message: string;
  icon: "warning" | "info";
  yesLabel?: string;
  onYes: () => void;
  onNo: () => void;
};

export function ConfirmDialog({
  title,
  message,
  icon,
  yesLabel = "Yes",
  onYes,
  onNo,
}: ConfirmDialogProps) {
  return (
    <PaintModal title={title}>
      <div className="flex items-start gap-3">
        <Win98Icon name={icon} size={32} />
        <p className="whitespace-pre-wrap">{message}</p>
      </div>
      <div className="flex justify-center gap-2">
        <button type="button" className="default" onClick={onYes} autoFocus>
          {yesLabel}
        </button>
        <button type="button" onClick={onNo}>
          No
        </button>
      </div>
    </PaintModal>
  );
}

export type TextDialogProps = {
  /** The draft typed so far. */
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

/** The Text tool's dialog: replaces the native browser prompt, so it never blocks the page and a script can type into it too. */
export function TextDialog({
  value,
  onChange,
  onSubmit,
  onCancel,
}: TextDialogProps) {
  return (
    <PaintModal title="Text">
      <form
        className="field-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="paint-text-input">Text:</label>
        <input
          id="paint-text-input"
          type="text"
          className="flex-1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (matchShortcut(event, "paint.textCancel")) onCancel();
          }}
          autoFocus
        />
      </form>
      <div className="flex justify-end gap-2">
        <button type="button" className="default" onClick={onSubmit}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </PaintModal>
  );
}

export type SaveAsDialogProps = {
  /** The name the field starts with, without or with its extension. */
  defaultName: string;
  defaultFormat: ImageMimeType;
  onSave: (name: string, mimeType: ImageMimeType) => void;
  onCancel: () => void;
};

/** File > Save As: a name and a format; the browser then downloads the file, nothing leaves this computer. */
export function SaveAsDialog({
  defaultName,
  defaultFormat,
  onSave,
  onCancel,
}: SaveAsDialogProps) {
  const [name, setName] = useState(defaultName);
  const [format, setFormat] = useState<ImageMimeType>(defaultFormat);
  const canSave = name.trim().length > 0;
  return (
    <PaintModal title="Save As">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave(name, format);
        }}
      >
        <div className="field-row">
          <label htmlFor="paint-save-name" className="w-24">
            File name:
          </label>
          <input
            id="paint-save-name"
            type="text"
            className="flex-1"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>
        <div className="field-row">
          <label htmlFor="paint-save-format" className="w-24">
            Save as type:
          </label>
          <select
            id="paint-save-format"
            className="flex-1"
            value={format}
            onChange={(event) =>
              setFormat(
                event.target.value === "image/jpeg"
                  ? "image/jpeg"
                  : "image/png",
              )
            }
          >
            <option value="image/png">PNG (*.png)</option>
            <option value="image/jpeg">JPEG (*.jpg)</option>
          </select>
        </div>
        <p className="text-[grey]">
          Downloads {canSave ? fileNameFor(name, format) : "the file"} to this
          computer. Nothing is uploaded anywhere.
        </p>
        <div className="flex justify-end gap-2">
          <button type="submit" className="default" disabled={!canSave}>
            Save
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </PaintModal>
  );
}
