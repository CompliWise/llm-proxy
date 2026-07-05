package admin

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/Instawork/llm-proxy/internal/adminusers"
)

func TestAuthenticatePortalBFF(t *testing.T) {
	t.Parallel()

	auth := &authenticator{
		portalAdminSecret: "test-secret",
		logger:            slog.New(slog.NewTextHandler(os.Stderr, nil)),
	}

	t.Run("valid headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/api/usage", nil)
		req.Header.Set(headerAdminSecret, "test-secret")
		req.Header.Set(headerPortalUserEmail, "admin@example.com")
		req.Header.Set(headerPortalUserRole, "admin")
		req.Header.Set(headerOrganizationID, "org-1")

		user, ok := auth.authenticatePortalBFF(req)
		if !ok {
			t.Fatal("expected portal BFF auth to succeed")
		}
		if user.Email != "admin@example.com" {
			t.Fatalf("email = %q, want admin@example.com", user.Email)
		}
		if user.Role != string(adminusers.RoleAdmin) {
			t.Fatalf("role = %q, want admin", user.Role)
		}
	})

	t.Run("wrong secret", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/api/usage", nil)
		req.Header.Set(headerAdminSecret, "wrong")
		req.Header.Set(headerPortalUserEmail, "admin@example.com")

		if _, ok := auth.authenticatePortalBFF(req); ok {
			t.Fatal("expected portal BFF auth to fail")
		}
	})

	t.Run("missing email", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/api/usage", nil)
		req.Header.Set(headerAdminSecret, "test-secret")

		if _, ok := auth.authenticatePortalBFF(req); ok {
			t.Fatal("expected portal BFF auth to fail")
		}
	})
}
