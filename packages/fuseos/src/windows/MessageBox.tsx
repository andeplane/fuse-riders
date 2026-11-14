import { Win98Icon } from "../ui/icons";

export type MessageBoxProps = {
  message: string;
  icon: "warning" | "info";
  onOk: () => void;
};

/** Body of a Win98 message box. */
export function MessageBox({ message, icon, onOk }: MessageBoxProps) {
  return (
    <div className="window-body flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Win98Icon name={icon} size={32} />
        <p className="whitespace-pre-wrap">{message}</p>
      </div>
      <div className="flex justify-center">
        <button type="button" className="default" onClick={onOk} autoFocus>
          OK
        </button>
      </div>
    </div>
  );
}
