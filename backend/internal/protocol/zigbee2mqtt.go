package protocol

import (
	"encoding/json"
	"math"
	"strings"
)

// zigbee2mqtt bridges ~4,000 Zigbee devices (Philips Hue, IKEA, Aqara, Tuya, ...).
// Configure the bridge with:  mqtt.base_topic: hb/{siteID}/{bridgeDeviceID}/z2m
type zigbee2mqtt struct{}

const z2mPrefix = "z2m/"

func (zigbee2mqtt) Parse(rel string, payload []byte) ([]Update, error) {
	if !strings.HasPrefix(rel, z2mPrefix) {
		return nil, nil
	}
	name := strings.TrimPrefix(rel, z2mPrefix)

	if name == "bridge/state" {
		return []Update{{Online: boolPtr(z2mOnline(payload))}}, nil
	}
	if strings.HasPrefix(name, "bridge/") {
		return nil, nil
	}
	if dev, ok := strings.CutSuffix(name, "/availability"); ok {
		return []Update{{ExternalID: dev, Online: boolPtr(z2mOnline(payload))}}, nil
	}
	if strings.HasSuffix(name, "/set") || strings.HasSuffix(name, "/get") {
		return nil, nil
	}

	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil, err
	}
	return []Update{{ExternalID: name, State: z2mNormalize(raw), Online: boolPtr(true)}}, nil
}

func (zigbee2mqtt) Command(root, externalID string, cmd map[string]any) ([]Message, error) {
	out := map[string]any{}
	for k, v := range cmd {
		switch k {
		case "on":
			if v.(bool) {
				out["state"] = "ON"
			} else {
				out["state"] = "OFF"
			}
		case "brightness":
			out["brightness"] = math.Round(v.(float64) * 254 / 100)
		case "target_temperature":
			out["current_heating_setpoint"] = v
		case "locked":
			if v.(bool) {
				out["state"] = "LOCK"
			} else {
				out["state"] = "UNLOCK"
			}
		default: // position, color_temp share names
			out[k] = v
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	return []Message{{Topic: root + "/" + z2mPrefix + externalID + "/set", Payload: b}}, nil
}

func z2mOnline(p []byte) bool {
	s := string(p)
	if strings.HasPrefix(s, "{") {
		var v struct{ State string }
		_ = json.Unmarshal(p, &v)
		s = v.State
	}
	return s == "online"
}

func z2mNormalize(raw map[string]any) map[string]any {
	s := map[string]any{}
	for k, v := range raw {
		switch k {
		case "state":
			if str, ok := v.(string); ok && (str == "LOCK" || str == "UNLOCK") {
				s["locked"] = str == "LOCK"
			} else if b, ok := onOff(v); ok {
				s["on"] = b
			}
		case "brightness":
			if f, ok := v.(float64); ok {
				s["brightness"] = math.Round(f * 100 / 254)
			}
		case "current_heating_setpoint", "occupied_heating_setpoint":
			s["target_temperature"] = v
		case "local_temperature":
			s["temperature"] = v
		case "temperature", "humidity", "battery", "power", "energy", "voltage", "current",
			"illuminance", "co2", "pressure", "position", "color_temp", "linkquality":
			if _, ok := v.(float64); ok {
				s[k] = v
			}
		case "pm25":
			s["pm25"] = v
		case "contact", "occupancy", "water_leak", "smoke", "tamper":
			if b, ok := v.(bool); ok {
				s[k] = b
			}
		}
	}
	return s
}
