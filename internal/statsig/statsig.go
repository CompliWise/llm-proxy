package statsig

import (
	"log/slog"
	"os"
	"strings"
	"sync"

	statsig "github.com/statsig-io/go-sdk"
)

const serverKeyEnv = "STATSIG_SERVER_KEY"

var (
	mu          sync.Mutex
	initialized bool
	logger      *slog.Logger
	serviceName = "llm-proxy"
)

func serviceUser() statsig.User {
	return statsig.User{
		UserID: serviceName,
		Custom: map[string]interface{}{"service": serviceName},
	}
}

func resolveUser(user *statsig.User) statsig.User {
	if user != nil {
		return *user
	}
	return serviceUser()
}

// Initialize starts the Statsig server SDK when STATSIG_SERVER_KEY is set.
// Missing keys are a no-op so local/CI environments stay usable.
func Initialize(log *slog.Logger, name string) {
	mu.Lock()
	defer mu.Unlock()

	if initialized {
		return
	}

	if log != nil {
		logger = log
	}
	if strings.TrimSpace(name) != "" {
		serviceName = name
	}

	secret := strings.TrimSpace(os.Getenv(serverKeyEnv))
	if secret == "" {
		return
	}

	tier := strings.TrimSpace(os.Getenv("NODE_ENV"))
	if strings.EqualFold(tier, "production") {
		tier = "production"
	} else if strings.TrimSpace(os.Getenv("ENVIRONMENT")) != "" {
		tier = strings.TrimSpace(os.Getenv("ENVIRONMENT"))
	} else if tier == "" {
		tier = "development"
	}

	statsig.InitializeWithOptions(secret, &statsig.Options{
		Environment: statsig.Environment{Tier: tier},
	})
	initialized = true
	statsig.LogEvent(statsig.Event{
		User:      serviceUser(),
		EventName: "llm_proxy.started",
		Metadata: map[string]string{
			"service": serviceName,
			"tier":    tier,
		},
	})
	if logger != nil {
		logger.Info("Statsig initialized", "service", serviceName, "tier", tier)
	}
}

// Shutdown flushes Statsig events. Safe to call when Statsig was never started.
func Shutdown() {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return
	}

	statsig.Shutdown()
	initialized = false
}

// LogEvent records a custom Statsig event for the llm-proxy service user.
func LogEvent(eventName string, metadata map[string]string) {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return
	}

	if metadata == nil {
		metadata = map[string]string{}
	}
	metadata["service"] = serviceName

	statsig.LogEvent(statsig.Event{
		User:      serviceUser(),
		EventName: eventName,
		Metadata:  metadata,
	})
}

// CheckGate evaluates a feature gate. Gates default to off when Statsig is disabled.
func CheckGate(gateName string) bool {
	return CheckGateForUser(nil, gateName)
}

// CheckGateForUser evaluates a feature gate for the given user.
func CheckGateForUser(user *statsig.User, gateName string) bool {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return false
	}

	return statsig.CheckGate(resolveUser(user), gateName)
}

// GetFeatureGate returns gate metadata. Value is false when Statsig is disabled.
func GetFeatureGate(gateName string, user *statsig.User) statsig.FeatureGate {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return statsig.FeatureGate{Name: gateName, Value: false}
	}

	return statsig.GetGate(resolveUser(user), gateName)
}

// GetDynamicConfig returns a dynamic config. Empty when Statsig is disabled.
func GetDynamicConfig(configName string, user *statsig.User) statsig.DynamicConfig {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return *statsig.NewConfig(configName, nil, "", "", nil)
	}

	return statsig.GetConfig(resolveUser(user), configName)
}

// GetExperiment returns an experiment config. Empty when Statsig is disabled.
func GetExperiment(experimentName string, user *statsig.User) statsig.DynamicConfig {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return *statsig.NewConfig(experimentName, nil, "", "", nil)
	}

	return statsig.GetExperiment(resolveUser(user), experimentName)
}

// GetLayer returns a layer. Empty when Statsig is disabled.
func GetLayer(layerName string, user *statsig.User) statsig.Layer {
	mu.Lock()
	defer mu.Unlock()

	if !initialized {
		return *statsig.NewLayer(layerName, nil, "", "", nil, "")
	}

	return statsig.GetLayer(resolveUser(user), layerName)
}

// ParameterStore is a typed parameter bag. The stable Go SDK does not yet
// expose Statsig Parameter Stores; getters return the provided fallback.
type ParameterStore struct {
	Name string
}

func (p ParameterStore) GetString(_ string, fallback string) string { return fallback }
func (p ParameterStore) GetBool(_ string, fallback bool) bool       { return fallback }
func (p ParameterStore) GetNumber(_ string, fallback float64) float64 {
	return fallback
}

// GetParameterStore returns a fallback store. Wire this to go-core when the
// proxy migrates off github.com/statsig-io/go-sdk.
func GetParameterStore(storeName string, _ *statsig.User) ParameterStore {
	return ParameterStore{Name: storeName}
}
