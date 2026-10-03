package mqttauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthzConfinesDevicesToTheirRoot(t *testing.T) {
	h := New(nil, nil, "internal-token", "core", "core-pass")
	mux := http.NewServeMux()
	h.Routes(mux)

	const site = "11111111-1111-1111-1111-111111111111"
	const dev = "22222222-2222-2222-2222-222222222222"
	const other = "33333333-3333-3333-3333-333333333333"
	user := site + "." + dev

	cases := []struct {
		topic string
		want  string
	}{
		{"hb/" + site + "/" + dev + "/state", "allow"},
		{"hb/" + site + "/" + dev + "/z2m/#", "allow"},
		{"hb/" + site + "/" + other + "/cmd", "deny"},
		{"hb/" + site + "/+/cmd", "deny"},
		{"hb/#", "deny"},
		{"hb/" + site + "/" + dev, "deny"},
		{"$SYS/brokers", "deny"},
	}
	for _, c := range cases {
		body := `{"username":"` + user + `","topic":"` + c.topic + `","action":"publish"}`
		if got := call(t, mux, "/internal/mqtt/authz", body, "internal-token"); got != c.want {
			t.Errorf("%s: got %s want %s", c.topic, got, c.want)
		}
	}

	if got := call(t, mux, "/internal/mqtt/authz", `{"username":"`+user+`","topic":"hb/x"}`, "wrong"); got != "" {
		t.Errorf("callback without internal token answered %q", got)
	}
}

func TestAuthnCoreUser(t *testing.T) {
	h := New(nil, nil, "tok", "core", "core-pass")
	mux := http.NewServeMux()
	h.Routes(mux)
	if got := call(t, mux, "/internal/mqtt/authn", `{"username":"core","password":"core-pass","clientid":"x"}`, "tok"); got != "allow" {
		t.Errorf("core login: %s", got)
	}
	if got := call(t, mux, "/internal/mqtt/authn", `{"username":"core","password":"nope","clientid":"x"}`, "tok"); got != "deny" {
		t.Errorf("bad core password: %s", got)
	}
	// Device login where client id differs from username is refused before any DB lookup.
	if got := call(t, mux, "/internal/mqtt/authn", `{"username":"11111111-1111-1111-1111-111111111111.22222222-2222-2222-2222-222222222222","password":"p","clientid":"other"}`, "tok"); got != "deny" {
		t.Errorf("mismatched client id: %s", got)
	}
}

func call(t *testing.T, h http.Handler, path, body, token string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("X-Internal-Token", token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		return ""
	}
	var out struct{ Result string }
	json.Unmarshal(rec.Body.Bytes(), &out)
	return out.Result
}
