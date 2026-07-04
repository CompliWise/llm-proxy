import { useState } from "react";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  className = "btn btn-sm btn-primary gap-2",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await writeClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      aria-label={label}
      className={className}
      onClick={onCopy}
      type="button"
    >
      {copied ? (
        <svg
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
        >
          <path d="m20 6-11 11-5-5" />
        </svg>
      ) : (
        <svg
          className="h-4 w-4 fill-none stroke-current"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <rect height="11" rx="2" width="11" x="9" y="9" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
