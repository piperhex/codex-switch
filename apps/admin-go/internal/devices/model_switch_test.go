package devices

import (
	"reflect"
	"testing"

	"github.com/codex-switch/admin-go/internal/platform"
)

func TestModelSwitchChangesOnlySelectedTarget(t *testing.T) {
	tests := []struct {
		path string
		want platform.JSON
	}{
		{"gui-account", platform.JSON{"guiAccountId": "selected", "guiProviderId": nil}},
		{"gui-provider", platform.JSON{"guiAccountId": nil, "guiProviderId": "selected"}},
		{"account", platform.JSON{"activeAccountId": "selected", "activeProviderId": nil, "activeProviderGroup": nil}},
		{"provider", platform.JSON{"activeProviderId": "selected", "activeProviderGroup": nil}},
		{"provider-group", platform.JSON{"activeProviderId": nil, "activeProviderGroup": "selected"}},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			if got := modelSwitchPatch(test.path, "selected"); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("unexpected state mutation: %#v", got)
			}
		})
	}
}

func TestGuiSwitchRequiresDesktopSupportButNotRunningProxy(t *testing.T) {
	for _, spec := range deviceCommands {
		if spec.capability != "gui-model-switch" {
			continue
		}
		if checkCapability(&Device{}, spec) == nil {
			t.Fatal("allowed unsupported GUI switch")
		}
		device := &Device{Capabilities: []string{"gui-model-switch"}}
		if err := checkCapability(device, spec); err != nil {
			t.Fatal("GUI selection should work before proxy startup", err)
		}
	}
	proxy := commandSpec{path: "provider", capability: "provider-switch"}
	if checkCapability(&Device{Capabilities: []string{"provider-switch"}}, proxy) == nil {
		t.Fatal("proxy switching still requires a running proxy")
	}
}

func TestDeviceRegistrationRefreshesGuiSelection(t *testing.T) {
	device := &Device{}
	mergeDeviceState(device, platform.JSON{
		"guiAccountId": "gui-account", "guiProviderId": nil,
		"capabilities": []interface{}{"gui-model-switch", "gui-model-switch", "unknown"},
	})
	if device.GuiAccountID == nil || *device.GuiAccountID != "gui-account" || device.GuiProviderID != nil {
		t.Fatal("GUI account was not recorded", device)
	}
	if !reflect.DeepEqual(device.Capabilities, []string{"gui-model-switch"}) {
		t.Fatal("GUI capability was not normalized", device.Capabilities)
	}
	mergeDeviceState(device, platform.JSON{"guiAccountId": nil, "guiProviderId": "gui-provider"})
	if device.GuiAccountID != nil || device.GuiProviderID == nil || *device.GuiProviderID != "gui-provider" {
		t.Fatal("GUI provider did not replace the account", device)
	}
	mergeDeviceState(device, platform.JSON{})
	if device.GuiAccountID != nil || device.GuiProviderID != nil {
		t.Fatal("legacy desktop retained stale GUI state")
	}
}
