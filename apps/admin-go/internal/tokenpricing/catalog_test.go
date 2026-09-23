package tokenpricing

import (
	"encoding/json"
	"math"
	"testing"
)

func TestDefaultsAndIndependentEdits(t *testing.T) {
	presets := Defaults()
	if err := presets.Validate(); err != nil {
		t.Fatal(err)
	}
	if len(presets.Models) != 10 {
		t.Fatalf("expected 10 models, got %d", len(presets.Models))
	}
	*presets.Models[0].Input = 999
	if *Defaults().Models[0].Input == 999 {
		t.Fatal("mutated bundled prices")
	}
}

func TestInvalidPresets(t *testing.T) {
	cases := map[string]func(*Document){
		"empty":           func(d *Document) { d.Models = nil },
		"duplicate model": func(d *Document) { d.Models[1].Model = d.Models[0].Model },
		"alias collision": func(d *Document) { d.Models[0].Aliases = []string{d.Models[1].Model} },
		"missing input":   func(d *Document) { d.Models[0].Input = nil },
		"negative price":  func(d *Document) { *d.Models[0].Input = -1 },
		"nonfinite price": func(d *Document) { *d.Models[0].Input = math.Inf(1) },
		"zero multiplier": func(d *Document) { *d.Models[0].FastModeMultiplier = 0 },
		"huge multiplier": func(d *Document) { *d.Models[0].FastModeMultiplier = 101 },
		"unsafe link":     func(d *Document) { d.Models[0].SourceURL = "javascript:alert(1)" },
		"invalid name":    func(d *Document) { d.Models[0].Model = "bad model" },
	}
	for name, edit := range cases {
		t.Run(name, func(t *testing.T) {
			presets := Defaults()
			edit(&presets)
			if presets.Validate() == nil {
				t.Fatal("accepted invalid presets")
			}
		})
	}
}

func TestAddModelAndZeroPrice(t *testing.T) {
	presets := Defaults()
	var model Model
	if err := json.Unmarshal([]byte(`{"model":"new-model","input":0,"cachedInput":0,"output":0,
        "fastModeMultiplier":3,"longContextPricing":true,"sourceUrl":""}`), &model); err != nil {
		t.Fatal(err)
	}
	presets.Models = append(presets.Models, model)
	if err := presets.Validate(); err != nil {
		t.Fatal(err)
	}
}
