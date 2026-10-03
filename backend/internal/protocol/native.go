package protocol

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// native is the dialect of Hooshban firmware (ESP32/ESP8266 SDK):
//
//	{root}/state   JSON object of canonical keys (retained)
//	{root}/status  "online" | "offline" (use as MQTT last will)
//	{root}/cmd     canonical command JSON, published by the platform
type native struct{}

var keyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

func (native) Parse(rel string, payload []byte) ([]Update, error) {
	switch rel {
	case "status":
		switch string(payload) {
		case "online":
			return []Update{{Online: boolPtr(true)}}, nil
		case "offline":
			return []Update{{Online: boolPtr(false)}}, nil
		}
		return nil, fmt.Errorf("bad status %q", payload)
	case "state":
		var raw map[string]any
		if err := json.Unmarshal(payload, &raw); err != nil {
			return nil, err
		}
		state := make(map[string]any, len(raw))
		for k, v := range raw {
			if !keyRe.MatchString(k) {
				continue
			}
			switch v.(type) {
			case bool, float64, string:
				state[k] = v
			}
		}
		return []Update{{State: state, Online: boolPtr(true)}}, nil
	}
	return nil, nil
}

func (native) Command(root, _ string, cmd map[string]any) ([]Message, error) {
	b, err := json.Marshal(cmd)
	if err != nil {
		return nil, err
	}
	return []Message{{Topic: root + "/cmd", Payload: b}}, nil
}
