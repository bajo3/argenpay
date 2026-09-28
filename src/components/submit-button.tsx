"use client";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botón de envío. Con `confirm`, antes de enviar muestra una ventana propia del sitio
 * (en lugar del cuadro gris del navegador) para confirmar la acción.
 */
export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText = "Procesando…",
  confirm,
  confirmTitle = "¿Confirmás esta acción?",
  confirmLabel = "Sí, confirmar",
  danger = false,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  confirm?: string;
  confirmTitle?: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function close() {
    dialog.current?.close();
    setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        type="submit"
        className={className}
        disabled={pending}
        onClick={(e) => {
          if (!confirm) return;
          e.preventDefault();
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {pending ? pendingText : children}
      </button>
      {confirm && (
        <dialog
          ref={dialog}
          onClose={() => setOpen(false)}
          onClick={(e) => {
            if (e.target === dialog.current) close(); // clic en el fondo
          }}
          className="m-auto w-[min(92vw,420px)] rounded-2xl border border-gold/30 bg-surface p-0 text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
        >
          {open && (
            <div className="animate-fade-up p-6">
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${danger ? "bg-bad/15 text-bad" : "bg-gold/15 text-gold-2"}`}>
                  {danger ? "!" : "?"}
                </span>
                <div>
                  <p className="font-display text-lg font-bold">{confirmTitle}</p>
                  <p className="mt-1.5 text-sm text-muted">{confirm}</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className="btn-ghost px-4 py-2" onClick={close} autoFocus>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`${danger ? "btn border border-bad/40 bg-bad/15 text-bad hover:bg-bad/25" : "btn-primary shine"} px-4 py-2`}
                  onClick={() => {
                    close();
                    // requestSubmit no dispara onClick, así que no vuelve a pedir confirmación.
                    const b = button.current;
                    b?.form?.requestSubmit(b);
                  }}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          )}
        </dialog>
      )}
    </>
  );
}
