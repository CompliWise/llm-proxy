package admin

import (
	"context"
	"crypto/subtle"
	"net/http"
	"os"
	"strings"

	"github.com/Instawork/llm-proxy/internal/adminusers"
)

const (
	headerAdminSecret     = "X-AI-Gateway-Admin-Secret"
	headerOrganizationID  = "X-Organization-Id"
	headerPortalUserEmail = "X-Portal-User-Email"
	headerPortalUserRole  = "X-Portal-User-Role"
)

type portalUserContextKey struct{}

// portalBFFMiddleware authenticates CompliWise portal BFF requests that present
// the shared admin secret and portal user identity headers. When valid, the
// resolved user is attached to the request context for currentUser.
func (a *authenticator) portalBFFMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, ok := a.authenticatePortalBFF(r); ok {
			r = r.WithContext(context.WithValue(r.Context(), portalUserContextKey{}, user))
		}
		next.ServeHTTP(w, r)
	})
}

// requireSyncSecret guards the CompliWise api sync endpoints. Unlike the portal
// BFF middleware it needs ONLY the shared admin secret (no portal-user headers),
// since the api posts key/config sync with just X-AI-Gateway-Admin-Secret.
func (a *authenticator) requireSyncSecret(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		got := strings.TrimSpace(r.Header.Get(headerAdminSecret))
		if a.portalAdminSecret == "" || got == "" ||
			subtle.ConstantTimeCompare([]byte(got), []byte(a.portalAdminSecret)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *authenticator) authenticatePortalBFF(r *http.Request) (*UserResponse, bool) {
	if a.portalAdminSecret == "" {
		return nil, false
	}

	secret := strings.TrimSpace(r.Header.Get(headerAdminSecret))
	if secret == "" || subtle.ConstantTimeCompare([]byte(secret), []byte(a.portalAdminSecret)) != 1 {
		return nil, false
	}

	email := strings.TrimSpace(r.Header.Get(headerPortalUserEmail))
	if email == "" || !strings.Contains(email, "@") {
		return nil, false
	}

	// Organization id is forwarded for audit and future multi-tenant routing.
	_ = strings.TrimSpace(r.Header.Get(headerOrganizationID))

	role := parsePortalUserRole(r.Header.Get(headerPortalUserRole))
	user, err := a.buildUserResponse(r.Context(), email, "", "", role)
	if err != nil {
		a.logger.Warn("portal BFF auth: user lookup failed", "email", email, "error", err)
		return nil, false
	}
	return user, true
}

func parsePortalUserRole(raw string) adminusers.Role {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case string(adminusers.RoleAdmin):
		return adminusers.RoleAdmin
	case string(adminusers.RoleEditor):
		return adminusers.RoleEditor
	case string(adminusers.RoleViewer):
		return adminusers.RoleViewer
	default:
		return adminusers.RoleEditor
	}
}

func portalUserFromContext(r *http.Request) (*UserResponse, bool) {
	user, ok := r.Context().Value(portalUserContextKey{}).(*UserResponse)
	return user, ok && user != nil
}

func readPortalAdminSecret() string {
	return strings.TrimSpace(os.Getenv("AI_GATEWAY_ADMIN_SYNC_SECRET"))
}
