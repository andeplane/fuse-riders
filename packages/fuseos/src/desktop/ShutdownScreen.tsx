export function ShutdownScreen({ onWakeUp }: { onWakeUp: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="absolute inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black"
      onClick={onWakeUp}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onWakeUp();
      }}
    >
      <p className="text-center font-mono text-2xl text-[#ffa500]">It&apos;s now safe to turn off your computer.</p>
    </div>
  );
}
