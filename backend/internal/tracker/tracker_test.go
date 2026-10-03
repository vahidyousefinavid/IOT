package tracker

import (
	"bufio"
	"bytes"
	"encoding/hex"
	"math"
	"strings"
	"testing"
	"time"
)

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(strings.ReplaceAll(s, " ", ""))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-5 }

// The login packet is the GT06 document's reference (its CRC 8CDD and our ack
// D9DC match the document). The location payload follows the document's
// example; its CRC is computed, since the login vector already proves the CRC.
func TestGT06LoginAndLocation(t *testing.T) {
	stream := append(
		unhex(t, "78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A"),
		unhex(t, "78 78 1F 12 0B 08 1D 11 2E 10 CC 02 7A C7 EB 0C 46 58 49 00 14 8F 01 CC 00 28 7D 00 1F B8 00 03 73 77 0D 0A")...,
	)
	r := bufio.NewReader(bytes.NewReader(stream))
	var s session
	g := gt06{}

	frame, err := g.readFrame(r)
	if err != nil {
		t.Fatalf("login frame: %v", err)
	}
	_, reply, err := g.decode(frame, &s)
	if err != nil || s.imei != "123456789012345" {
		t.Fatalf("login: imei=%q err=%v", s.imei, err)
	}
	if want := unhex(t, "78 78 05 01 00 01 D9 DC 0D 0A"); !bytes.Equal(reply, want) {
		t.Errorf("login ack = % X, want % X", reply, want)
	}

	frame, err = g.readFrame(r)
	if err != nil {
		t.Fatalf("location frame: %v", err)
	}
	reps, _, err := g.decode(frame, &s)
	if err != nil || len(reps) != 1 {
		t.Fatalf("location: %v %v", reps, err)
	}
	p := reps[0]
	if !p.Valid || !near(p.Lat, 23.1116683) || !near(p.Lon, 114.4092850) || p.Satellites != 12 {
		t.Errorf("position = %+v", p)
	}
	if !p.Time.Equal(time.Date(2011, 8, 29, 17, 46, 16, 0, time.UTC)) {
		t.Errorf("time = %v", p.Time)
	}
}

func TestGT06RejectsCorruptCRC(t *testing.T) {
	bad := unhex(t, "78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DE 0D 0A")
	if _, err := (gt06{}).readFrame(bufio.NewReader(bytes.NewReader(bad))); err == nil {
		t.Fatal("corrupt CRC accepted")
	}
}

func TestGT06RequiresLogin(t *testing.T) {
	var s session
	frame := []byte{gt06Heartbeat, 0x06, 0x04, 0x04, 0x00, 0x02, 0x00, 0x01}
	if _, _, err := (gt06{}).decode(frame, &s); err == nil {
		t.Fatal("data before login accepted")
	}
}

func TestGT06HeartbeatStatus(t *testing.T) {
	s := session{imei: "123456789012345"}
	// terminal info 0x46: ACC on (bit1), charging (bit2), GPS on (bit6); voltage 6; GSM 4
	frame := []byte{gt06Heartbeat, 0x46, 0x06, 0x04, 0x00, 0x02, 0x00, 0x09}
	reps, reply, err := (gt06{}).decode(frame, &s)
	if err != nil || len(reps) != 1 || reply == nil {
		t.Fatalf("heartbeat: %v %v", reps, err)
	}
	r := reps[0]
	if !*r.Ignition || !*r.Charging || *r.PowerCut || *r.Battery != 100 || *r.GSM != 4 {
		t.Errorf("status = %+v", r)
	}
}

func TestGT06EngineCommand(t *testing.T) {
	s := session{imei: "123456789012345"}
	pkt, err := (gt06{}).encode(&s, ActionImmobilize)
	if err != nil {
		t.Fatal(err)
	}
	// Round-trip through the frame reader proves length and CRC are consistent.
	frame, err := (gt06{}).readFrame(bufio.NewReader(bytes.NewReader(pkt)))
	if err != nil {
		t.Fatalf("own command packet invalid: %v", err)
	}
	if frame[0] != gt06Command || !bytes.Contains(frame, []byte("Relay,1#")) {
		t.Errorf("frame = % X", frame)
	}
}

func TestH02Position(t *testing.T) {
	in := "junk*HQ,9170000000,V1,103512,A,3544.5210,N,05124.8860,E,010.00,090,300926,FFFFFBFF#"
	h := h02{}
	var s session
	frame, err := h.readFrame(bufio.NewReader(strings.NewReader(in)))
	if err != nil {
		t.Fatal(err)
	}
	reps, _, err := h.decode(frame, &s)
	if err != nil || len(reps) != 1 || s.imei != "9170000000" {
		t.Fatalf("decode: %v %v %q", reps, err, s.imei)
	}
	p := reps[0]
	if !near(p.Lat, 35+44.5210/60) || !near(p.Lon, 51+24.8860/60) || !near(p.Speed, 18.52) || p.Course != 90 {
		t.Errorf("position = %+v", p)
	}
	if !p.Time.Equal(time.Date(2026, 9, 30, 10, 35, 12, 0, time.UTC)) {
		t.Errorf("time = %v", p.Time)
	}
}

func TestH02RejectsIDChange(t *testing.T) {
	s := session{imei: "9170000000"}
	if _, _, err := (h02{}).decode([]byte("HQ,9170000001,LINK,103512"), &s); err == nil {
		t.Fatal("ID switch mid-connection accepted")
	}
}

func TestH02FrameLimit(t *testing.T) {
	in := "*HQ," + strings.Repeat("9", 1000) + "#"
	if _, err := (h02{}).readFrame(bufio.NewReader(strings.NewReader(in))); err == nil {
		t.Fatal("oversized frame accepted")
	}
}
