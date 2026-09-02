package statsig

import (
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInitializeWithoutKeyIsNoop(t *testing.T) {
	t.Setenv("STATSIG_SERVER_KEY", "")
	Initialize(nil, "llm-proxy-test")
	require.False(t, CheckGate("any_gate"))
	LogEvent("noop", map[string]string{"ok": "true"})
	Shutdown()
}

func TestCheckGateDefaultsClosed(t *testing.T) {
	os.Unsetenv("STATSIG_SERVER_KEY")
	require.False(t, CheckGate("missing_gate"))
}

func TestEvaluationsDefaultWhenDisabled(t *testing.T) {
	t.Setenv("STATSIG_SERVER_KEY", "")
	gate := GetFeatureGate("example_gate", nil)
	require.Equal(t, "example_gate", gate.Name)
	require.False(t, gate.Value)

	config := GetDynamicConfig("example_config", nil)
	require.Equal(t, "fallback", config.GetString("title", "fallback"))

	experiment := GetExperiment("example_experiment", nil)
	require.Equal(t, 0.1, experiment.GetNumber("discount", 0.1))

	layer := GetLayer("example_layer", nil)
	require.Equal(t, "Welcome", layer.GetString("title", "Welcome"))

	store := GetParameterStore("example_store", nil)
	require.Equal(t, "example_store", store.Name)
	require.Equal(t, "Home", store.GetString("page_title", "Home"))
	require.False(t, store.GetBool("enabled", false))
}
