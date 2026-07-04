import { Link } from "react-router-dom";
import { maskKeyId, parseMaskedCredentialId } from "../../lib/format";
import { keyDetailPath, resolveKeyLinkTarget } from "../../lib/key-routes";
import type { APIKey } from "../../types";
import { MaskedCredentialId } from "./masked-credential-id";

function renderCredentialId(value: string, className: string) {
  if (parseMaskedCredentialId(value)) {
    return <MaskedCredentialId className={className} value={value} />;
  }
  return (
    <span className={`font-mono text-xs ${className}`.trim()}>{value}</span>
  );
}

interface KeyLinkProps {
  className?: string;
  keys?: APIKey[];
  keyValue?: string;
  /** Primary label; falls back to key description or masked id. */
  label?: string;
  maskedId?: string;
  scope?: string;
  /** Secondary mono line; defaults to masked id when showMasked is set. */
  secondaryLabel?: string;
  showMasked?: boolean;
}

export default function KeyLink({
  keys,
  keyValue,
  maskedId,
  scope,
  label,
  secondaryLabel,
  showMasked = false,
  className = "",
}: KeyLinkProps) {
  const target = resolveKeyLinkTarget(keys, { keyValue, maskedId, scope });
  const record =
    target && keys ? keys.find((k) => k.key === target) : undefined;
  const masked = maskedId ?? (target ? maskKeyId(target) : undefined);
  const primary = label ?? record?.description ?? masked ?? target ?? "—";
  const secondary = secondaryLabel ?? masked;

  const primaryIsMaskedId = Boolean(masked && primary === masked);
  const primaryNode = primaryIsMaskedId ? (
    renderCredentialId(primary, "")
  ) : (
    <span>{primary}</span>
  );

  if (!target) {
    return (
      <span className={className}>
        {primaryNode}
        {showMasked && secondary && primary !== secondary ? (
          <span className="mt-0.5 block text-base-content/50">
            {renderCredentialId(secondary, "")}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      className={`link link-hover link-primary no-underline ${className}`.trim()}
      to={keyDetailPath(target)}
    >
      {primaryIsMaskedId ? (
        renderCredentialId(primary, "")
      ) : (
        <span className="font-medium">{primary}</span>
      )}
      {showMasked && secondary ? (
        <span className="mt-0.5 block opacity-70">
          {renderCredentialId(secondary, "")}
        </span>
      ) : null}
    </Link>
  );
}
