package protocol

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// tasmota covers the thousands of ESP-based plugs, relays and dimmers
// running Tasmota firmware. Configure with:
//
//	FullTopic hb/{siteID}/{deviceID}/%prefix%/
type tasmota struct{}

func (tasmota) Parse(rel string, payload []byte) ([]Update, error) {
	switch rel {
	case "tele/LWT":
		return []Update{{Online: boolPtr(string(payload) == "Online")}}, nil
	case "stat/POWER":
		if on, ok := onOff(string(payload)); ok {
			return []Update{{State: map[string]any{"on": on}, Online: boolPtr(true)}}, nil
		}
		return nil, nil
	case "tele/STATE", "stat/RESULT", "tele/SENSOR", "stat/STATUS10":
		var raw map[string]any
		if err := json.Unmarshal(payload, &raw); err != nil {
			return nil, err
		}
		if sns, ok := raw["StatusSNS"].(map[string]any); ok {
			raw = sns
		}
		s := tasmotaNormalize(raw)
		if len(s) == 0 {
			return nil, nil
		}
		return []Update{{State: s, Online: boolPtr(true)}}, nil
	}
	return nil, nil
}

func (tasmota) Command(root, _ string, cmd map[string]any) ([]Message, error) {
	var out []Message
	for k, v := range cmd {
		switch k {
		case "on":
			p := "OFF"
			if v.(bool) {
				p = "ON"
			}
			out = append(out, Message{Topic: root + "/cmnd/POWER", Payload: []byte(p)})
		case "brightness":
			out = append(out, Message{Topic: root + "/cmnd/Dimmer", Payload: []byte(strconv.Itoa(int(v.(float64))))})
		case "color_temp":
			out = append(out, Message{Topic: root + "/cmnd/CT", Payload: []byte(strconv.Itoa(int(v.(float64))))})
		case "position":
			out = append(out, Message{Topic: root + "/cmnd/ShutterPosition", Payload: []byte(strconv.Itoa(int(v.(float64))))})
		default:
			return nil, fmt.Errorf("tasmota does not support %q", k)
		}
	}
	return out, nil
}

func tasmotaNormalize(raw map[string]any) map[string]any {
	s := map[string]any{}
	for k, v := range raw {
		switch {
		case k == "POWER" || k == "POWER1":
			if on, ok := onOff(v); ok {
				s["on"] = on
			}
		case strings.HasPrefix(k, "POWER"):
			if on, ok := onOff(v); ok {
				s["on_"+strings.TrimPrefix(k, "POWER")] = on
			}
		case k == "Dimmer":
			s["brightness"] = v
		case k == "CT":
			s["color_temp"] = v
		case k == "ENERGY":
			if e, ok := v.(map[string]any); ok {
				for src, dst := range map[string]string{"Power": "power", "Total": "energy", "Voltage": "voltage", "Current": "current"} {
					if f, ok := e[src].(float64); ok {
						s[dst] = round1(f)
					}
				}
			}
		default:
			// Sensor blocks such as {"AM2301": {"Temperature": 23.1, "Humidity": 40}}.
			if m, ok := v.(map[string]any); ok {
				for src, dst := range map[string]string{"Temperature": "temperature", "Humidity": "humidity", "Pressure": "pressure", "Illuminance": "illuminance", "CarbonDioxide": "co2"} {
					if f, ok := m[src].(float64); ok {
						s[dst] = round1(f)
					}
				}
			}
		}
	}
	return s
}
