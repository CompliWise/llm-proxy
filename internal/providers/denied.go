package providers

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// modelDeniedErrorClass marks proxy-origin allow-list denials in the shared
// X-LLM-Proxy-Error-Class header.
const modelDeniedErrorClass = "model_not_allowed"

// WriteModelDeniedResponse writes a 403 for a request whose model is not on the
// requesting organization's model allow-list (KAN-354). Unlike a retired model
// (a vendor-shaped 404 "model_not_found"), a denial is the proxy's own policy
// rejection, so the body is a single OpenAI-compatible error envelope that SDK
// clients across providers surface with a clear message. The shared
// X-LLM-Proxy-Error-Class header identifies the response as a proxy-origin
// policy rejection rather than an upstream error.
func WriteModelDeniedResponse(w http.ResponseWriter, model string) error {
	body, err := json.Marshal(map[string]any{
		"error": map[string]any{
			"message": fmt.Sprintf("The model `%s` is not permitted for your organization.", model),
			"type":    "invalid_request_error",
			"param":   "model",
			"code":    modelDeniedErrorClass,
		},
	})
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(HeaderModelRetired, modelDeniedErrorClass)
	w.WriteHeader(http.StatusForbidden)
	_, err = w.Write(body)
	return err
}
