import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from './icon';
export function Dialog({
  title,
  onClose,
  children,
  drawer = false,
  className = '',
  returnFocusId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
  className?: string;
  returnFocusId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      const target =
        opener instanceof HTMLElement && opener.isConnected
          ? opener
          : returnFocusId
            ? document.getElementById(returnFocusId)
            : null;
      target?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${drawer ? 'dialog drawer' : 'dialog'} ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
