import type { ByoBanActions } from "../../hooks/use-byo-ban-actions";
import { parseCredentialHashFromMaskedId } from "../../lib/byo-ban";
import { isByoMaskedKeyId } from "../../lib/pii-key-display";
import type { Provider } from "../../types";

interface ByoBanButtonProps {
  actions: ByoBanActions;
  compact?: boolean;
  maskedId: string;
  provider: string;
}

export default function ByoBanButton({
  maskedId,
  provider,
  compact = true,
  actions,
}: ByoBanButtonProps) {
  const hash = parseCredentialHashFromMaskedId(maskedId);

  if (!(actions.canManage && isByoMaskedKeyId(maskedId) && hash && provider)) {
    return null;
  }

  const existing = actions.findBan(provider, hash);

  if (existing) {
    return (
      <button
        className={
          compact
            ? "btn btn-ghost btn-xs text-success"
            : "btn btn-outline btn-sm"
        }
        disabled={actions.pending}
        onClick={() => actions.unban(existing.provider, existing.hash)}
        type="button"
      >
        {actions.pending ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          "Unban"
        )}
      </button>
    );
  }

  return (
    <button
      className={
        compact
          ? "btn btn-ghost btn-xs text-error"
          : "btn btn-outline btn-sm text-error"
      }
      disabled={actions.pending}
      onClick={() => actions.ban(provider as Provider, maskedId)}
      type="button"
    >
      {actions.pending ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        "Ban BYO"
      )}
    </button>
  );
}
