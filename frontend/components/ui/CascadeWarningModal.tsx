"use client";

import { AlertTriangle, X } from "lucide-react";

export interface CascadeWarningModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog for destructive / cascade actions on fields and reports. */
export default function CascadeWarningModal({
  open,
  title,
  description,
  confirmLabel = "Confirm & Cascade Delete",
  busy = false,
  onCancel,
  onConfirm,
}: CascadeWarningModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cascade-modal-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600">
              <AlertTriangle className="size-6" aria-hidden />
            </span>
            <h2 id="cascade-modal-title" className="text-[20px] font-bold tracking-tight text-ink">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close modal"
            className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-black/[0.05]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{description}</p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary !min-h-11 !px-4 text-[15px]">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
