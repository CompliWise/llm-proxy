import { type FormEvent, useEffect, useState } from "react";
import { useConfig, useMe, useUpdateKey } from "../../hooks/queries";
import {
  costLimitsFromForm,
  formPiiOffRequiresBedrock,
  type KeyFormState,
  keyFormFromRecord,
  piiFromFormValue,
  rateLimitsFromForm,
} from "../../lib/key-form";
import type { APIKey } from "../../types";
import { useToast } from "../ui/toast";
import { CostFields, PiiFields, RateLimitFields } from "./api-keys-modal";

interface KeyDetailPolicyEditorProps {
  editorMaxDollars: number | null;
  keyRecord: APIKey;
  routeKey: string;
  section: "cost" | "pii" | "rate-limits";
}

export default function KeyDetailPolicyEditor({
  keyRecord,
  routeKey,
  section,
  editorMaxDollars,
}: KeyDetailPolicyEditorProps) {
  const { push } = useToast();
  const updateKey = useUpdateKey();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const globalPiiEnabled = Boolean(config?.features?.pii_redact);
  const canBypassPiiBedrockPolicy = Boolean(
    me?.can_bypass_pii_off_non_bedrock_policy
  );

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<KeyFormState>(() =>
    keyFormFromRecord(keyRecord, "metered")
  );

  useEffect(() => {
    if (!editing) {
      setForm(keyFormFromRecord(keyRecord, "metered"));
    }
  }, [keyRecord, editing]);

  const piiOffRequiresBedrock = formPiiOffRequiresBedrock(
    form.redact_pii,
    globalPiiEnabled,
    canBypassPiiBedrockPolicy
  );

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    const {
      daily_cost_limit: dailyCostLimit,
      monthly_cost_limit: monthlyCostLimit,
    } = costLimitsFromForm(form);
    const editorMaxCents = me?.editor_limits?.max_daily_cost_limit_cents ?? 0;
    const activeCostLimit =
      form.cost_limit_period === "monthly" ? monthlyCostLimit : dailyCostLimit;
    if (
      section === "cost" &&
      editorMaxCents > 0 &&
      activeCostLimit > editorMaxCents
    ) {
      push(
        `${form.cost_limit_period === "monthly" ? "Monthly" : "Daily"} cost limit cannot exceed $${editorMaxDollars ?? editorMaxCents / 100}`,
        "error"
      );
      return;
    }

    try {
      if (section === "cost") {
        await updateKey.mutateAsync({
          key: routeKey,
          body: {
            daily_cost_limit: dailyCostLimit,
            monthly_cost_limit: monthlyCostLimit,
          },
        });
      } else if (section === "pii") {
        await updateKey.mutateAsync({
          key: routeKey,
          body: { redact_pii: piiFromFormValue(form.redact_pii) },
        });
      } else {
        await updateKey.mutateAsync({
          key: routeKey,
          body: rateLimitsFromForm(form),
        });
      }
      push("Key settings updated", "success");
      setEditing(false);
    } catch (err) {
      push(
        err instanceof Error ? err.message : "Failed to update key",
        "error"
      );
    }
  };

  const onCancel = () => {
    setForm(keyFormFromRecord(keyRecord, "metered"));
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex justify-end border-base-300/70 border-b px-5 py-3">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setEditing(true)}
          type="button"
        >
          Edit settings
        </button>
      </div>
    );
  }

  return (
    <form
      className="border-base-300/70 border-b bg-base-200/30 p-5"
      onSubmit={onSave}
    >
      {section === "cost" ? (
        <CostFields
          editorMaxDollars={editorMaxDollars}
          form={form}
          setForm={setForm}
          showEnabled={false}
        />
      ) : null}
      {section === "pii" ? (
        <PiiFields
          editingKey={keyRecord}
          form={form}
          piiOffRequiresBedrock={piiOffRequiresBedrock}
          setForm={setForm}
        />
      ) : null}
      {section === "rate-limits" ? (
        <RateLimitFields form={form} setForm={setForm} />
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="btn btn-primary btn-sm"
          disabled={updateKey.isPending}
          type="submit"
        >
          {updateKey.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : null}
          Save
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
