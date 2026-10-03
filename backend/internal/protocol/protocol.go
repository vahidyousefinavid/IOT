// Package protocol translates vendor-specific MQTT dialects to and from one
// canonical device model, so the rest of the system never sees vendor formats.
//
// Every device (or bridge) owns an isolated topic root: hb/{siteID}/{deviceID}.
// Direct devices (our firmware, Tasmota) publish under it themselves; bridges
// (Zigbee2MQTT, and through it thousands of Zigbee products) are configured
// with their base topic under it, and their child devices are discovered.
//
// Canonical state keys:
//
//	on bool · brightness 0-100 · color_temp mired · target_temperature °C ·
//	temperature °C · humidity % · power W · energy kWh · voltage V · current A ·
//	battery % · position 0-100 · locked bool · contact bool · occupancy bool
package protocol

import (
	"fmt"
	"math"
	"strings"
)

// Update is what an incoming message means in canonical terms.
type Update struct {
	// ExternalID is empty for the device itself, or names a child behind a bridge.
	ExternalID string
	State      map[string]any
	Online     *bool
}

type Message struct {
	Topic   string
	Payload []byte
}

type Adapter interface {
	// Parse interprets a message whose topic is root + "/" + rel.
	Parse(rel string, payload []byte) ([]Update, error)
	// Command encodes a validated canonical command for the device (or for the
	// child externalID behind a bridge).
	Command(root, externalID string, cmd map[string]any) ([]Message, error)
}

var registry = map[string]Adapter{
	"native":      native{},
	"zigbee2mqtt": zigbee2mqtt{},
	"tasmota":     tasmota{},
}

func Get(name string) (Adapter, bool) {
	a, ok := registry[name]
	return a, ok
}

func Supported(name string) bool { _, ok := registry[name]; return ok }

func Root(siteID, deviceID string) string { return "hb/" + siteID + "/" + deviceID }

// SplitTopic parses hb/{site}/{device}/{rel...}.
func SplitTopic(topic string) (siteID, deviceID, rel string, ok bool) {
	parts := strings.SplitN(topic, "/", 4)
	if len(parts) != 4 || parts[0] != "hb" {
		return "", "", "", false
	}
	return parts[1], parts[2], parts[3], true
}

// TelemetryKeys are numeric canonical keys worth keeping as time series.
var TelemetryKeys = map[string]bool{
	"temperature": true, "humidity": true, "power": true, "energy": true,
	"voltage": true, "current": true, "battery": true, "illuminance": true,
	"co2": true, "pm25": true, "pressure": true, "speed": true,
}

// ValidateCommand accepts only known keys with sane values; devices never
// receive arbitrary client-supplied payloads.
func ValidateCommand(cmd map[string]any) error {
	if len(cmd) == 0 || len(cmd) > 8 {
		return fmt.Errorf("command must have 1-8 fields")
	}
	for k, v := range cmd {
		switch k {
		case "on", "locked", "immobilized":
			if _, ok := v.(bool); !ok {
				return fmt.Errorf("%s must be boolean", k)
			}
		case "brightness", "position":
			if err := numRange(k, v, 0, 100); err != nil {
				return err
			}
		case "target_temperature":
			if err := numRange(k, v, 5, 35); err != nil {
				return err
			}
		case "color_temp":
			if err := numRange(k, v, 150, 500); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported command field %q", k)
		}
	}
	return nil
}

func numRange(k string, v any, lo, hi float64) error {
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || f < lo || f > hi {
		return fmt.Errorf("%s must be a number in [%g, %g]", k, lo, hi)
	}
	return nil
}

func boolPtr(b bool) *bool { return &b }

func onOff(v any) (bool, bool) {
	switch x := v.(type) {
	case bool:
		return x, true
	case string:
		switch strings.ToUpper(x) {
		case "ON", "TRUE", "1":
			return true, true
		case "OFF", "FALSE", "0":
			return false, true
		}
	}
	return false, false
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
