package protocol

import (
	"encoding/json"
	"testing"
)

func TestSplitTopic(t *testing.T) {
	s, d, rel, ok := SplitTopic("hb/site/dev/z2m/living lamp")
	if !ok || s != "site" || d != "dev" || rel != "z2m/living lamp" {
		t.Fatalf("got %q %q %q %v", s, d, rel, ok)
	}
	if _, _, _, ok := SplitTopic("other/site/dev/state"); ok {
		t.Fatal("foreign prefix accepted")
	}
	if _, _, _, ok := SplitTopic("hb/site/dev"); ok {
		t.Fatal("topic without suffix accepted")
	}
}

func TestValidateCommand(t *testing.T) {
	ok := []string{`{"on":true}`, `{"brightness":50}`, `{"target_temperature":22.5,"on":false}`}
	bad := []string{`{}`, `{"on":"yes"}`, `{"brightness":101}`, `{"target_temperature":80}`, `{"exec":"rm -rf /"}`}
	for _, s := range ok {
		if err := ValidateCommand(decode(t, s)); err != nil {
			t.Errorf("%s rejected: %v", s, err)
		}
	}
	for _, s := range bad {
		if err := ValidateCommand(decode(t, s)); err == nil {
			t.Errorf("%s accepted", s)
		}
	}
}

func TestNativeParse(t *testing.T) {
	u, err := native{}.Parse("state", []byte(`{"on":true,"temperature":21.5,"Bad-Key":1,"nested":{"x":1}}`))
	if err != nil || len(u) != 1 {
		t.Fatalf("parse: %v %v", u, err)
	}
	st := u[0].State
	if st["on"] != true || st["temperature"] != 21.5 {
		t.Errorf("state = %v", st)
	}
	if _, ok := st["Bad-Key"]; ok {
		t.Error("invalid key kept")
	}
	if _, ok := st["nested"]; ok {
		t.Error("nested value kept")
	}
}

func TestZigbee2MQTT(t *testing.T) {
	z := zigbee2mqtt{}
	u, err := z.Parse("z2m/kitchen/lamp", []byte(`{"state":"ON","brightness":254,"linkquality":80}`))
	if err != nil || len(u) != 1 {
		t.Fatalf("parse: %v %v", u, err)
	}
	if u[0].ExternalID != "kitchen/lamp" || u[0].State["on"] != true || u[0].State["brightness"] != 100.0 {
		t.Errorf("update = %+v", u[0])
	}

	u, _ = z.Parse("z2m/kitchen/lamp/availability", []byte(`{"state":"offline"}`))
	if len(u) != 1 || *u[0].Online {
		t.Errorf("availability = %+v", u)
	}
	if u, _ := z.Parse("z2m/kitchen/lamp/set", []byte(`{}`)); u != nil {
		t.Error("own command echoed back as state")
	}

	msgs, err := z.Command("hb/s/b", "kitchen/lamp", map[string]any{"on": true, "brightness": 50.0})
	if err != nil || len(msgs) != 1 || msgs[0].Topic != "hb/s/b/z2m/kitchen/lamp/set" {
		t.Fatalf("command: %+v %v", msgs, err)
	}
	var out map[string]any
	json.Unmarshal(msgs[0].Payload, &out)
	if out["state"] != "ON" || out["brightness"] != 127.0 {
		t.Errorf("payload = %v", out)
	}
}

func TestTasmota(t *testing.T) {
	ta := tasmota{}
	u, err := ta.Parse("tele/SENSOR", []byte(`{"Time":"x","ENERGY":{"Power":12.34,"Total":1.5},"AM2301":{"Temperature":23.1,"Humidity":40}}`))
	if err != nil || len(u) != 1 {
		t.Fatalf("parse: %v %v", u, err)
	}
	st := u[0].State
	if st["power"] != 12.3 || st["energy"] != 1.5 || st["temperature"] != 23.1 || st["humidity"] != 40.0 {
		t.Errorf("state = %v", st)
	}
	u, _ = ta.Parse("tele/LWT", []byte("Offline"))
	if len(u) != 1 || *u[0].Online {
		t.Errorf("lwt = %+v", u)
	}
	msgs, _ := ta.Command("hb/s/d", "", map[string]any{"on": false})
	if len(msgs) != 1 || msgs[0].Topic != "hb/s/d/cmnd/POWER" || string(msgs[0].Payload) != "OFF" {
		t.Errorf("command = %+v", msgs)
	}
}

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatal(err)
	}
	return m
}
