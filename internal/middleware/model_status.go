package middleware

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/Instawork/llm-proxy/internal/allowlist"
	"github.com/Instawork/llm-proxy/internal/apikeys"
	"github.com/Instawork/llm-proxy/internal/circuit"
	"github.com/Instawork/llm-proxy/internal/config"
	"github.com/Instawork/llm-proxy/internal/modelstatusstats"
	"github.com/Instawork/llm-proxy/internal/providers"
)

// ModelStatusMiddleware short-circuits requests to retired models and records
// deprecated-model usage before forwarding to upstream providers. When a
// non-nil allowlistResolver is supplied and the model_allowlist feature is
// enabled, it also enforces a per-organization model allow-list (KAN-354):
// a request whose model is not on the requesting organization's non-empty
// allow-list is rejected with 403. Every other allow-list case fails open.
func ModelStatusMiddleware(
	pm *providers.ProviderManager,
	cfg *config.YAMLConfig,
	recorder *modelstatusstats.Recorder,
	metrics circuit.MetricsSink,
	allowlistResolver allowlist.Resolver,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" || r.URL.Path == "/redact" || strings.HasPrefix(r.URL.Path, "/admin/") {
				next.ServeHTTP(w, r)
				return
			}

			provider := GetProviderFromRequest(pm, r)
			if provider == nil {
				next.ServeHTTP(w, r)
				return
			}

			model, _ := provider.ExtractRequestModelAndMessages(r)
			if model == "" {
				next.ServeHTTP(w, r)
				return
			}

			providerName := provider.GetName()
			orgID := ""
			if rec, ok := apikeys.FromContext(r.Context()); ok {
				orgID = rec.OrganizationID()
			}
			if entry, retired := cfg.LookupRetiredModel(providerName, model); retired {
				recorder.RecordRetired(providerName, model, orgID)
				emitModelMetric(metrics, "model.retired_call", providerName, model)
				if err := providers.WriteRetiredModelResponse(w, provider, model, entry); err != nil {
					log.Printf("model status: failed to encode retired response: %v", err)
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set(providers.HeaderModelRetired, "model_retired")
					w.WriteHeader(http.StatusNotFound)
					fmt.Fprintf(w, `{"error":"model retired"}`)
				}
				return
			}

			// Per-organization model allow-list enforcement (KAN-354). This is
			// a hard fail-open: the ONLY case that blocks is a resolved,
			// non-empty allow-list that does not contain the requested model.
			// Feature off, nil resolver, no org, an empty/unavailable list, or
			// any cache/fetch error all forward — a transient api/Redis problem
			// must never turn into a 5xx or a wrongful block.
			if cfg.Features.ModelAllowlist.Enabled && allowlistResolver != nil && orgID != "" {
				models, found, err := allowlistResolver.Allowlist(r.Context(), orgID)
				switch {
				case err != nil:
					log.Printf("model status: allow-list unavailable for org=%s, failing open: %v", orgID, err)
				case found && len(models) > 0 && !modelInAllowlist(model, models):
					recorder.RecordDenied(providerName, model, orgID)
					emitModelMetric(metrics, "model.denied_call", providerName, model)
					if werr := providers.WriteModelDeniedResponse(w, model); werr != nil {
						log.Printf("model status: failed to encode denied response: %v", werr)
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusForbidden)
						fmt.Fprintf(w, `{"error":"model not allowed for organization"}`)
					}
					return
				}
			}

			modelCfg, _ := cfg.GetModelConfig(providerName, model)
			if modelCfg != nil && modelCfg.Deprecated {
				recorder.RecordDeprecated(providerName, model, orgID)
				emitModelMetric(metrics, "model.deprecated_call", providerName, model)
			} else if modelCfg == nil {
				recorder.RecordUnknown(providerName, model, orgID)
				log.Printf("model status: unrecognized model %q for provider %q", model, providerName)
				emitModelMetric(metrics, "model.unknown_call", providerName, "__unknown__")
			}

			next.ServeHTTP(w, r)
		})
	}
}

// modelInAllowlist reports whether model is present in the org's allow-list.
// Matching is case-insensitive and trims surrounding whitespace: the allow-list
// carries both aliases and raw provider model ids, and being lenient here keeps
// a cosmetic mismatch from producing a wrongful denial (the fail-open goal). A
// genuinely different model still does not match and is denied.
func modelInAllowlist(model string, allow []string) bool {
	target := strings.ToLower(strings.TrimSpace(model))
	if target == "" {
		return true // no model to check — let the request through (fail open)
	}
	for _, a := range allow {
		if strings.ToLower(strings.TrimSpace(a)) == target {
			return true
		}
	}
	return false
}

func emitModelMetric(metrics circuit.MetricsSink, name, provider, model string) {
	if metrics == nil {
		return
	}
	tags := []string{
		"provider:" + provider,
		"model:" + model,
	}
	_ = metrics.Incr(name, tags, 1)
}
