// Package tracker is the TCP gateway for cellular (SIM card) GPS trackers.
//
// Unlike MQTT devices, these trackers speak fixed vendor protocols over
// GPRS/LTE and identify themselves only by IMEI. The gateway:
//
//   - accepts connections only from IMEIs registered to a site (others are
//     dropped at the first frame), with per-IP and global connection caps,
//     frame size limits and idle timeouts;
//   - decodes positions, ignition, battery and alarms into Report values;
//   - keeps each tracker's connection so commands (engine cut / resume)
//     can be pushed down it.
//
// Protocol-level security is weak by design of these devices (plaintext,
// IMEI as the only identity). For high-assurance fleets use SIM cards on a
// private APN/VPN so only the operator network can reach the gateway ports.
package tracker

import (
	"bufio"
	"context"
	"errors"
	"time"
)

// Report is one decoded message from a tracker.
type Report struct {
	HasPosition bool
	Time        time.Time
	Valid       bool // GPS fix
	Lat, Lon    float64
	Speed       float64 // km/h
	Course      int
	Satellites  int

	Ignition   *bool
	Charging   *bool
	PowerCut   *bool // external power / relay cut reported by the device
	Battery    *int  // percent
	GSM        *int  // signal 0-4
	Alarm      string
	CommandAck string
}

// Sink receives what the gateway decodes. Implemented by the device service.
type Sink interface {
	// Known reports whether an IMEI is registered for protocol.
	Known(ctx context.Context, protocol, imei string) bool
	Report(ctx context.Context, protocol, imei string, r Report) error
	Online(ctx context.Context, protocol, imei string, online bool)
}

// session is per-connection protocol state.
type session struct {
	imei   string
	serial uint16
}

func (s *session) nextSerial() uint16 {
	s.serial++
	return s.serial
}

// Action is a command the platform can send to a tracker.
type Action string

const (
	ActionImmobilize Action = "immobilize"
	ActionMobilize   Action = "mobilize"
)

var ErrUnsupported = errors.New("command not supported by this tracker protocol")

type codec interface {
	// readFrame returns the next frame; it must bound its memory use.
	readFrame(r *bufio.Reader) ([]byte, error)
	// decode interprets a frame. It sets s.imei once the tracker identifies
	// itself and returns bytes to write back (acknowledgements), if any.
	decode(frame []byte, s *session) (reports []Report, reply []byte, err error)
	encode(s *session, a Action) ([]byte, error)
}

var codecs = map[string]codec{
	"gt06": gt06{},
	"h02":  h02{},
}

// Protocols lists the tracker protocols the gateway implements.
func Protocols() []string { return []string{"gt06", "h02"} }

func IsTrackerProtocol(p string) bool { _, ok := codecs[p]; return ok }

func boolPtr(b bool) *bool { return &b }
func intPtr(i int) *int    { return &i }
