package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Instawork/llm-proxy/internal/apikeys"
	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A key synced from the CompliWise api must persist its organization id so the
// request pipeline, rate limiter, and admin monitoring can segregate by tenant.
func TestUpsertCompliwiseKey_PersistsOrgID(t *testing.T) {
	t.Setenv("LLM_PROXY_OPENAI_ADMIN_KEY", "sk-upstream-openai")
	h, store := testAdminHandler(t)

	secret := apikeys.KeyPrefix + "orgkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	body, _ := json.Marshal(map[string]any{
		"organizationId": "org-42",
		"secret":         secret,
		"allowedModels":  []string{"gpt-4o"},
	})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/compliwise-keys/key-1", bytes.NewReader(body))
	req = mux.SetURLVars(req, map[string]string{"keyId": "key-1"})
	rec := httptest.NewRecorder()
	h.handleUpsertCompliwiseKey(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	got, err := store.GetKeyRecord(context.Background(), secret)
	require.NoError(t, err)
	assert.Equal(t, "org-42", got.OrgID)
	assert.Equal(t, "org-42", got.OrganizationID())
	assert.Equal(t, "openai", got.Provider)
	// The Tags marker is also written for legacy readers.
	assert.Equal(t, "org-42", got.Tags["organization_id"])
}

// OrganizationID() resolves the dedicated attribute first, then the legacy Tags
// marker, then "" for unscoped keys.
func TestAPIKeyOrganizationID_Fallbacks(t *testing.T) {
	assert.Equal(t, "org-x", (&apikeys.APIKey{OrgID: "org-x"}).OrganizationID())
	assert.Equal(t, "org-tag", (&apikeys.APIKey{Tags: map[string]string{"organization_id": "org-tag"}}).OrganizationID())
	// OrgID wins over the Tags fallback when both are present.
	assert.Equal(t, "org-x", (&apikeys.APIKey{OrgID: "org-x", Tags: map[string]string{"organization_id": "other"}}).OrganizationID())
	// Unscoped/legacy key with neither.
	assert.Equal(t, "", (&apikeys.APIKey{}).OrganizationID())
}
