package admin

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Instawork/llm-proxy/internal/apikeys"
	"github.com/gorilla/mux"
)

// syncSecretMiddleware guards the CompliWise api sync endpoints using ONLY the
// shared admin secret from the environment. It is deliberately independent of
// the admin dashboard authenticator (Google OAuth / sessions), so the sync
// routes work even when the admin dashboard is disabled or unconfigured.
func syncSecretMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		want := strings.TrimSpace(os.Getenv("AI_GATEWAY_ADMIN_SYNC_SECRET"))
		got := strings.TrimSpace(r.Header.Get(headerAdminSecret))
		if want == "" || got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RegisterSyncRoutes mounts the CompliWise api key/config sync endpoints on r,
// independent of the admin dashboard. Call it unconditionally at startup.
func RegisterSyncRoutes(r *mux.Router, deps Deps) {
	h := newHandler(deps, nil)
	sub := r.PathPrefix("/admin/api").Subrouter()
	sub.Use(syncSecretMiddleware)
	sub.HandleFunc("/compliwise-keys/{keyId}", h.handleUpsertCompliwiseKey).Methods(http.MethodPost, http.MethodOptions)
	sub.HandleFunc("/compliwise-keys/{keyId}", h.handleRevokeCompliwiseKey).Methods(http.MethodDelete, http.MethodOptions)
	sub.HandleFunc("/org-config/{organizationId}", h.handleUpsertOrgConfig).Methods(http.MethodPost, http.MethodOptions)
}

// compliwiseKeySyncRequest is the JSON body the CompliWise api POSTs to
// /admin/api/compliwise-keys/{keyId}. It mirrors the api's ProxyKeySyncPayload.
type compliwiseKeySyncRequest struct {
	OrganizationID      string   `json:"organizationId"`
	Secret              string   `json:"secret"`
	RequestsPerMinute   *int     `json:"requestsPerMinute"`
	TokensPerMinute     *int     `json:"tokensPerMinute"`
	TokensPerDay        *int     `json:"tokensPerDay"`
	CostLimitCentsDaily *int64   `json:"costLimitCentsDaily"`
	DailyCostLimitCents *int64   `json:"dailyCostLimitCents"`
	AllowedModels       []string `json:"allowedModels"`
	PiiRedact           *bool    `json:"piiRedact"`
	ExpiresAt           *string  `json:"expiresAt"`
}

// deriveProvider infers the provider from the requested models — the key-sync
// payload carries no provider. Defaults to openai.
func deriveProvider(models []string) string {
	for _, m := range models {
		lm := strings.ToLower(strings.TrimSpace(m))
		switch {
		case strings.HasPrefix(lm, "gpt"), strings.HasPrefix(lm, "o1"), strings.HasPrefix(lm, "o3"), strings.Contains(lm, "openai"):
			return "openai"
		case strings.HasPrefix(lm, "claude"), strings.Contains(lm, "anthropic"):
			return "anthropic"
		case strings.HasPrefix(lm, "gemini"), strings.Contains(lm, "google"):
			return "gemini"
		}
	}
	return "openai"
}

// providerUpstreamKey returns the proxy's configured upstream provider API key.
// MVP: shared keys from env (e.g. LLM_PROXY_OPENAI_ADMIN_KEY). Per-org BYO keys
// arrive with the multi-tenant work.
func providerUpstreamKey(provider string) string {
	return strings.TrimSpace(os.Getenv("LLM_PROXY_" + strings.ToUpper(provider) + "_ADMIN_KEY"))
}

// handleUpsertCompliwiseKey stores a key pushed by the CompliWise api so that
// requests bearing that key resolve through the normal request pipeline.
func (h *handler) handleUpsertCompliwiseKey(w http.ResponseWriter, r *http.Request) {
	if h.deps.APIKeyStore == nil {
		h.writeAPIKeyStoreUnavailable(w)
		return
	}
	keyID := mux.Vars(r)["keyId"]

	var req compliwiseKeySyncRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	secret := strings.TrimSpace(req.Secret)
	if secret == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "secret is required"})
		return
	}

	provider := deriveProvider(req.AllowedModels)
	actualKey := providerUpstreamKey(provider)
	if actualKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no upstream key configured for provider " + provider})
		return
	}

	var dailyCost int64
	switch {
	case req.DailyCostLimitCents != nil:
		dailyCost = *req.DailyCostLimitCents
	case req.CostLimitCentsDaily != nil:
		dailyCost = *req.CostLimitCentsDaily
	}

	rec := apikeys.APIKey{
		Provider:       provider,
		ActualKey:      actualKey,
		DailyCostLimit: dailyCost,
		Description:    "compliwise:" + req.OrganizationID,
		Enabled:        true,
		RedactPII:      req.PiiRedact,
		Tags: map[string]string{
			"source":            "compliwise",
			"organization_id":   req.OrganizationID,
			"compliwise_key_id": keyID,
		},
	}
	if req.RequestsPerMinute != nil {
		rec.RateLimitRPM = *req.RequestsPerMinute
	}
	if req.TokensPerMinute != nil {
		rec.RateLimitTPM = *req.TokensPerMinute
	}
	if req.TokensPerDay != nil {
		rec.RateLimitTPD = *req.TokensPerDay
	}
	if req.ExpiresAt != nil && strings.TrimSpace(*req.ExpiresAt) != "" {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(*req.ExpiresAt)); err == nil {
			rec.ExpiresAt = &t
		}
	}

	if _, err := h.deps.APIKeyStore.UpsertSyncedKey(r.Context(), keyID, secret, rec); err != nil {
		h.deps.Logger.Error("compliwise key sync failed", "key_id", keyID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to sync key"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "keyId": keyID, "provider": provider})
}

// handleRevokeCompliwiseKey removes a key previously synced by the CompliWise api.
func (h *handler) handleRevokeCompliwiseKey(w http.ResponseWriter, r *http.Request) {
	if h.deps.APIKeyStore == nil {
		h.writeAPIKeyStoreUnavailable(w)
		return
	}
	keyID := mux.Vars(r)["keyId"]
	if err := h.deps.APIKeyStore.RevokeSyncedKeyByID(r.Context(), keyID); err != nil {
		h.deps.Logger.Error("compliwise key revoke failed", "key_id", keyID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to revoke key"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "keyId": keyID})
}

// handleUpsertOrgConfig accepts per-org config from the CompliWise api. MVP:
// acknowledge + log (keys resolve provider/upstream from env today). Persist
// per-org overrides here when multi-tenant routing lands.
func (h *handler) handleUpsertOrgConfig(w http.ResponseWriter, r *http.Request) {
	orgID := mux.Vars(r)["organizationId"]
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if h.deps.Logger != nil {
		h.deps.Logger.Info("CompliWise org-config sync", "organization_id", orgID)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "organizationId": orgID})
}
