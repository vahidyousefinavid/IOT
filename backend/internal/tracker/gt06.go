package tracker

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"
)

// gt06 implements the Concox GT06 binary protocol, also used by a large
// family of clones (GT06N, GT02, TK100, many unbranded car trackers).
//
// Frame: 78 78 | len(1) | proto(1) info… serial(2) | crc(2) | 0D 0A
// or     79 79 | len(2) | …                                   (long frames)
// len counts proto..crc; the CRC-ITU covers len..serial.
type gt06 struct{}

const (
	gt06Login     = 0x01
	gt06GPS       = 0x10
	gt06LBS       = 0x11
	gt06Location  = 0x12
	gt06Heartbeat = 0x13
	gt06CmdReply  = 0x15
	gt06Alarm     = 0x16
	gt06Location2 = 0x22
	gt06Alarm2    = 0x26
	gt06Command   = 0x80
	maxGT06Frame  = 1024
)

var errBadFrame = errors.New("malformed frame")

func (gt06) readFrame(r *bufio.Reader) ([]byte, error) {
	// Resynchronise on the start marker if the stream contains junk.
	for {
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		if b != 0x78 && b != 0x79 {
			continue
		}
		nb, err := r.Peek(1)
		if err != nil {
			return nil, err
		}
		if nb[0] != b {
			continue
		}
		r.ReadByte()

		var n int
		var head []byte
		if b == 0x78 {
			l, err := r.ReadByte()
			if err != nil {
				return nil, err
			}
			n, head = int(l), []byte{l}
		} else {
			var l [2]byte
			if _, err := io.ReadFull(r, l[:]); err != nil {
				return nil, err
			}
			n, head = int(binary.BigEndian.Uint16(l[:])), l[:]
		}
		if n < 5 || n > maxGT06Frame {
			return nil, errBadFrame
		}
		body := make([]byte, n+2) // proto..crc + 0D 0A
		if _, err := io.ReadFull(r, body); err != nil {
			return nil, err
		}
		if body[n] != 0x0D || body[n+1] != 0x0A {
			return nil, errBadFrame
		}
		payload := body[:n-2]
		crc := binary.BigEndian.Uint16(body[n-2 : n])
		if crcITU(append(append([]byte{}, head...), payload...)) != crc {
			return nil, errBadFrame
		}
		return payload, nil // proto + info + serial
	}
}

func (g gt06) decode(frame []byte, s *session) ([]Report, []byte, error) {
	if len(frame) < 3 {
		return nil, nil, errBadFrame
	}
	proto := frame[0]
	info := frame[1 : len(frame)-2]
	serial := binary.BigEndian.Uint16(frame[len(frame)-2:])

	if proto == gt06Login {
		if len(info) < 8 {
			return nil, nil, errBadFrame
		}
		// Terminal ID is the 15-digit IMEI as 8 BCD bytes with a leading 0.
		s.imei = hex.EncodeToString(info[:8])[1:]
		return nil, gt06Ack(proto, serial), nil
	}
	if s.imei == "" {
		return nil, nil, errors.New("data before login")
	}

	switch proto {
	case gt06GPS, gt06Location, gt06Location2:
		r, n, err := gt06Position(info)
		if err != nil {
			return nil, nil, err
		}
		// 0x22 carries LBS (8 bytes) and then the ACC (ignition) byte.
		if proto == gt06Location2 && len(info) >= n+8+1 {
			r.Ignition = boolPtr(info[n+8] != 0)
		}
		return []Report{r}, nil, nil

	case gt06Heartbeat:
		if len(info) < 3 {
			return nil, gt06Ack(proto, serial), nil
		}
		r := gt06Status(info[0], info[1], info[2])
		return []Report{r}, gt06Ack(proto, serial), nil

	case gt06Alarm, gt06Alarm2:
		r, n, err := gt06Position(info)
		if err != nil {
			return nil, nil, err
		}
		// LBS block: length byte + content, then terminal info, voltage, GSM, alarm, language.
		if len(info) > n {
			lbs := int(info[n])
			if p := n + lbs; lbs > 0 && len(info) >= p+4 {
				st := gt06Status(info[p], info[p+1], info[p+2])
				r.Ignition, r.Charging, r.PowerCut, r.Battery, r.GSM = st.Ignition, st.Charging, st.PowerCut, st.Battery, st.GSM
				r.Alarm = gt06AlarmName(info[p+3])
			}
		}
		return []Report{r}, gt06Ack(proto, serial), nil

	case gt06CmdReply:
		// cmd length(1) server flag(4) content…
		if len(info) > 5 {
			return []Report{{CommandAck: string(info[5:])}}, nil, nil
		}
		return nil, nil, nil

	case gt06LBS:
		return nil, nil, nil // cell-tower only fix; ignored
	}
	return nil, nil, nil
}

// gt06Position parses the 18-byte GPS block and returns how many bytes it used.
func gt06Position(b []byte) (Report, int, error) {
	const size = 18
	if len(b) < size {
		return Report{}, 0, errBadFrame
	}
	t := time.Date(2000+int(b[0]), time.Month(b[1]), int(b[2]), int(b[3]), int(b[4]), int(b[5]), 0, time.UTC)
	sats := int(b[6] & 0x0F)
	lat := float64(binary.BigEndian.Uint32(b[7:11])) / 1800000
	lon := float64(binary.BigEndian.Uint32(b[11:15])) / 1800000
	speed := float64(b[15])
	flags := b[16]
	course := int(flags&0x03)<<8 | int(b[17])
	if flags&0x04 == 0 { // bit2: 1 = north
		lat = -lat
	}
	if flags&0x08 != 0 { // bit3: 1 = west
		lon = -lon
	}
	return Report{
		HasPosition: true,
		Time:        t,
		Valid:       flags&0x10 != 0,
		Lat:         lat,
		Lon:         lon,
		Speed:       speed,
		Course:      course,
		Satellites:  sats,
	}, size, nil
}

func gt06Status(info, voltage, gsm byte) Report {
	v := int(voltage)
	if v > 6 {
		v = 6
	}
	return Report{
		Ignition: boolPtr(info&0x02 != 0),
		Charging: boolPtr(info&0x04 != 0),
		PowerCut: boolPtr(info&0x80 != 0),
		Battery:  intPtr(v * 100 / 6),
		GSM:      intPtr(int(gsm)),
	}
}

func gt06AlarmName(b byte) string {
	switch b {
	case 0x01:
		return "sos"
	case 0x02:
		return "power_cut"
	case 0x03:
		return "vibration"
	case 0x04:
		return "geofence_enter"
	case 0x05:
		return "geofence_exit"
	case 0x06:
		return "overspeed"
	}
	return ""
}

func gt06Ack(proto byte, serial uint16) []byte {
	return gt06Packet(proto, nil, serial)
}

func gt06Packet(proto byte, info []byte, serial uint16) []byte {
	body := []byte{byte(1 + len(info) + 2 + 2), proto}
	body = append(body, info...)
	body = binary.BigEndian.AppendUint16(body, serial)
	body = binary.BigEndian.AppendUint16(body, crcITU(body))
	return append(append([]byte{0x78, 0x78}, body...), 0x0D, 0x0A)
}

// Engine cut/resume text commands per Concox; some clones use DYD/HFYD instead.
func (gt06) encode(s *session, a Action) ([]byte, error) {
	var cmd string
	switch a {
	case ActionImmobilize:
		cmd = "Relay,1#"
	case ActionMobilize:
		cmd = "Relay,0#"
	default:
		return nil, ErrUnsupported
	}
	info := []byte{byte(4 + len(cmd)), 0, 0, 0, 1}
	info = append(info, cmd...)
	if len(info) > 200 {
		return nil, fmt.Errorf("command too long")
	}
	return gt06Packet(gt06Command, info, s.nextSerial()), nil
}

// crcITU is CRC-16/X-25 as used by GT06.
func crcITU(b []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, v := range b {
		crc ^= uint16(v)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0x8408
			} else {
				crc >>= 1
			}
		}
	}
	return ^crc
}
