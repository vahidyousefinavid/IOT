package tracker

import (
	"bufio"
	"errors"
	"strconv"
	"strings"
	"time"
)

// h02 implements the text H02 protocol (Sinotrack ST-901/ST-906 and the many
// trackers sharing it). Frames look like:
//
//	*HQ,9170000000,V1,103512,A,3544.5210,N,05124.8860,E,000.00,000,300926,FFFFFBFF#
//
// Time is UTC, coordinates are (d)ddmm.mmmm, speed is in knots.
// The binary "$…" variant of H02 is not supported.
type h02 struct{}

const maxH02Frame = 512

func (h02) readFrame(r *bufio.Reader) ([]byte, error) {
	for {
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		if b == '$' {
			return nil, errors.New("binary H02 variant not supported")
		}
		if b == '*' {
			break
		}
	}
	buf := make([]byte, 0, 128)
	for {
		b, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		if b == '#' {
			return buf, nil
		}
		if len(buf) >= maxH02Frame {
			return nil, errBadFrame
		}
		buf = append(buf, b)
	}
}

func (h02) decode(frame []byte, s *session) ([]Report, []byte, error) {
	f := strings.Split(string(frame), ",")
	if len(f) < 3 || f[0] != "HQ" || !validID(f[1]) {
		return nil, nil, errBadFrame
	}
	if s.imei == "" {
		s.imei = f[1]
	} else if s.imei != f[1] {
		return nil, nil, errors.New("tracker ID changed mid-connection")
	}

	switch f[2] {
	case "V1":
		if len(f) < 12 {
			return nil, nil, errBadFrame
		}
		lat, err1 := h02Coord(f[5], f[6] == "S")
		lon, err2 := h02Coord(f[7], f[8] == "W")
		knots, err3 := strconv.ParseFloat(f[9], 64)
		t, err4 := time.Parse("150405020106", f[3]+f[11])
		if err := errors.Join(err1, err2, err3, err4); err != nil {
			return nil, nil, errBadFrame
		}
		course, _ := strconv.Atoi(strings.Split(f[10], ".")[0])
		r := Report{
			HasPosition: true,
			Time:        t.UTC(),
			Valid:       f[4] == "A",
			Lat:         lat,
			Lon:         lon,
			Speed:       knots * 1.852,
			Course:      course,
		}
		return []Report{r}, nil, nil
	case "V4":
		return []Report{{CommandAck: strings.Join(f[3:], ",")}}, nil, nil
	}
	return nil, nil, nil // LINK / NBR heartbeats: the connection itself marks the tracker online
}

// h02Coord converts (d)ddmm.mmmm to decimal degrees.
func h02Coord(v string, negative bool) (float64, error) {
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, err
	}
	deg := float64(int(f / 100))
	d := deg + (f-deg*100)/60
	if negative {
		d = -d
	}
	return d, nil
}

// Engine commands differ between H02 firmwares; not sent blind.
func (h02) encode(*session, Action) ([]byte, error) { return nil, ErrUnsupported }

// validID accepts IMEIs and the shorter numeric IDs some trackers use.
func validID(id string) bool {
	if len(id) < 6 || len(id) > 20 {
		return false
	}
	for _, c := range id {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ValidID is exported for validating IDs entered by installers.
func ValidID(id string) bool { return validID(id) }
