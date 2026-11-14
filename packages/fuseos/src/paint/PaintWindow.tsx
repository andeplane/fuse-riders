import type { PointerEvent as ReactPointerEvent } from 'react';
import { useState } from 'react';

import type { MenuDef } from '../windows/MenuBar';
import { MenuBar } from '../windows/MenuBar';
import { useWindowCommands } from '../windows/useWindowCommands';

import { ConfirmDialog, PaintModal, TextDialog } from './PaintDialogs';
import { PaintStateProvider } from './PaintStateProvider';
import type { Point } from './paintTools';
import { BRUSH_SIZES, PAINT_TOOLS } from './paintTools';
import { WIN98_PALETTE } from './palette';
import type { PaintViewModel } from './usePaintViewModel';
import { usePaintViewModel } from './usePaintViewModel';

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>): Point {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: Math.floor((event.clientX - rect.left) * scaleX), y: Math.floor((event.clientY - rect.top) * scaleY) };
}

function Toolbox({ vm }: { vm: PaintViewModel }) {
  return (
    <div className="flex w-16 shrink-0 flex-col gap-2 p-1" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <div className="grid grid-cols-2 gap-0.5">
        {PAINT_TOOLS.map((item) => (
          <button
            key={item.tool}
            type="button"
            aria-label={item.label}
            aria-pressed={vm.tool === item.tool}
            title={item.label}
            className={`toolbar-button h-7 ${vm.tool === item.tool ? 'pressed' : ''}`}
            onClick={() => vm.setTool(item.tool)}
          >
            <span aria-hidden>{item.glyph}</span>
          </button>
        ))}
      </div>
      <div className="sunken-panel flex flex-col items-center gap-1 bg-white py-1" role="radiogroup" aria-label="Brush size">
        {BRUSH_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={vm.brushSize === size}
            aria-label={`Size ${size}`}
            className={`flat flex h-5 w-10 items-center justify-center ${vm.brushSize === size ? 'selected-label' : ''}`}
            onClick={() => vm.setBrushSize(size)}
          >
            <span aria-hidden className="rounded-full bg-current" style={{ width: size, height: size, display: 'inline-block' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Palette({ vm }: { vm: PaintViewModel }) {
  return (
    <div className="flex shrink-0 items-center gap-2 p-1" role="group" aria-label="Colors">
      <div className="sunken-panel relative h-8 w-8 shrink-0 bg-[silver]" aria-label={`Foreground ${vm.foreground}, background ${vm.background}`}>
        <span className="absolute bottom-1 right-1 h-4 w-4 border border-[grey]" style={{ background: vm.background }} data-testid="background-swatch" />
        <span className="absolute left-1 top-1 h-4 w-4 border border-black" style={{ background: vm.foreground }} data-testid="foreground-swatch" />
      </div>
      <div className="grid grid-flow-col grid-rows-2 gap-0.5">
        {WIN98_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={vm.foreground === color}
            className="h-4 w-4 border border-[grey] p-0"
            style={{ background: color, minWidth: 0, minHeight: 0, boxShadow: 'none' }}
            onClick={() => vm.setForeground(color)}
            onContextMenu={(event) => {
              event.preventDefault();
              vm.setBackground(color);
            }}
          />
        ))}
      </div>
    </div>
  );
}

type PaintCanvasProps = { vm: PaintViewModel; attachCanvas: PaintViewModel['attachCanvas'] };

function PaintCanvas({ vm, attachCanvas }: PaintCanvasProps) {
  const [position, setPosition] = useState<Point | undefined>(undefined);
  return (
    <>
      <div className="sunken-panel min-h-0 min-w-0 flex-1 overflow-auto bg-[#808080] p-2">
        <canvas
          ref={attachCanvas}
          width={640}
          height={400}
          aria-label="Drawing canvas"
          className="cursor-crosshair touch-none bg-white"
          style={{ imageRendering: 'pixelated' }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (typeof event.currentTarget.setPointerCapture === 'function') {
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Not every pointer supports capture.
              }
            }
            vm.pointerDown(canvasPoint(event), event.button);
          }}
          onPointerMove={(event) => {
            const at = canvasPoint(event);
            setPosition(at);
            if (event.buttons !== 0) vm.pointerMove(at);
          }}
          onPointerUp={(event) => vm.pointerUp(canvasPoint(event))}
          onPointerLeave={() => setPosition(undefined)}
        />
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field flex-1">{vm.status}</p>
        <p className="status-bar-field w-24">{position ? `${position.x},${position.y}` : ''}</p>
        <p className="status-bar-field w-24">
          {vm.size.width}x{vm.size.height}
        </p>
      </footer>
    </>
  );
}

function Dialogs({ vm }: { vm: PaintViewModel }) {
  const dialog = vm.dialog;
  switch (dialog.kind) {
    case 'none':
      return null;
    case 'confirmDiscard':
      return <ConfirmDialog title="Paint" icon="warning" message={`Discard the changes to ${vm.fileName ?? 'untitled'}?`} onYes={vm.confirmDiscard} onNo={vm.closeDialog} />;
    case 'text':
      return <TextDialog value={dialog.text} onChange={vm.setDialogText} onSubmit={vm.submitText} onCancel={vm.cancelText} />;
    case 'busy':
      return (
        <PaintModal title="Paint">
          <p>{dialog.message}</p>
        </PaintModal>
      );
  }
}

function PaintBody({ windowId }: { windowId: string }) {
  const vm = usePaintViewModel(windowId);
  const commands = useWindowCommands();
  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { label: 'New', onSelect: vm.newImage },
        { label: 'Open...', onSelect: vm.openImage },
        { label: 'Save', onSelect: vm.save },
        { label: 'Save As...', onSelect: vm.save },
        { separator: true },
        { label: 'Set As Wallpaper', onSelect: vm.setAsWallpaper },
        { separator: true },
        { label: 'Exit', onSelect: vm.close },
      ],
    },
    {
      label: 'Edit',
      items: [{ label: 'Undo', disabled: !vm.canUndo, onSelect: vm.undo }],
    },
    {
      label: 'Image',
      items: [
        { label: 'Flip Horizontal', onSelect: () => vm.flip('horizontal') },
        { label: 'Flip Vertical', onSelect: () => vm.flip('vertical') },
        { label: 'Rotate 90°', onSelect: vm.rotate },
        { separator: true },
        { label: 'Clear Image', onSelect: vm.clear },
      ],
    },
    {
      label: 'Help',
      items: [{ label: 'About Paint', onSelect: () => commands.open({ kind: 'about' }) }],
    },
  ];
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <MenuBar menus={menus} />
      <div className="flex min-h-0 flex-1">
        <Toolbox vm={vm} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PaintCanvas vm={vm} attachCanvas={vm.attachCanvas} />
        </div>
      </div>
      <Palette vm={vm} />
      <Dialogs vm={vm} />
    </div>
  );
}

export function PaintWindow({ windowId }: { windowId: string }) {
  return (
    <PaintStateProvider>
      <PaintBody windowId={windowId} />
    </PaintStateProvider>
  );
}
