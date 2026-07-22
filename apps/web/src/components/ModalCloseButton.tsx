type ModalCloseButtonProps = {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
};

export function ModalCloseButton({
  onClick,
  label = "Close",
  disabled = false,
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className="modal-close"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
