package devices

import "github.com/codex-switch/admin-go/internal/platform"

// Keep GUI and proxy choices independent, including explicit clearing of the other source kind.
func modelSwitchPatch(path, value string) platform.JSON {
	patch := platform.JSON{}
	switch path {
	case "account":
		patch["activeAccountId"], patch["activeProviderId"], patch["activeProviderGroup"] = value, nil, nil
	case "provider":
		patch["activeProviderId"], patch["activeProviderGroup"] = value, nil
	case "provider-group":
		patch["activeProviderId"], patch["activeProviderGroup"] = nil, value
	case "openai-auth-account":
		patch["openaiAuthAccountId"] = value
	case "gui-account":
		patch["guiAccountId"], patch["guiProviderId"] = value, nil
	case "gui-provider":
		patch["guiAccountId"], patch["guiProviderId"] = nil, value
	}
	return patch
}
