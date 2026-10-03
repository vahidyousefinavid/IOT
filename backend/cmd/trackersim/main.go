// Command trackersim behaves like a cellular car GPS tracker (GT06 or H02).
// It drives along Valiasr street in Tehran, reports ignition and battery,
// and — for GT06 — obeys engine cut/resume commands (the car stops).
//
//	trackersim -addr localhost:5023 -proto gt06 -imei 359710049012345
//	trackersim -addr localhost:5013 -proto h02  -imei 9170000000
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"strings"
	"sync/atomic"
	"time"
)

// A loop along Valiasr St. (south → north) and back.
var route = [][2]float64{
	{35.6892, 51.4064}, {35.6990, 51.4060}, {35.7100, 51.4079}, {35.7219, 51.4085},
	{35.7336, 51.4091}, {35.7445, 51.4103}, {35.7571, 51.4112}, {35.7702, 51.4140},
	{35.7803, 51.4178}, {35.7702, 51.4140}, {35.7445, 51.4103}, {35.7100, 51.4079},
}

func main() {
	addr := flag.String("addr", "localhost:5023", "gateway address")
	proto := flag.String("proto", "gt06", "gt06 | h02")
	imei := flag.String("imei", "359710049012345", "tracker IMEI / ID")
	every := flag.Duration("every", 5*time.Second, "report interval")
	park := flag.Bool("park", false, "stay parked (speed 0, ignition off)")
	flag.Parse()

	c, err := net.Dial("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()
	log.Printf("connected to %s as %s %s", *addr, *proto, *imei)

	var cut atomic.Bool
	if *proto == "gt06" {
		send(c, gt06Packet(0x01, bcdIMEI(*imei), 1))
		go gt06Reader(c, &cut)
	}

	pos, leg, serial := route[0], 0, uint16(2)
	tick := time.NewTicker(*every)
	for range tick.C {
		speed := 0.0
		if !cut.Load() && !*park {
			// Move ~70 km/h towards the next waypoint.
			next := route[(leg+1)%len(route)]
			step := 70.0 / 3.6 * every.Seconds() / 111_000
			d := math.Hypot(next[0]-pos[0], next[1]-pos[1])
			if d <= step {
				pos, leg = next, (leg+1)%len(route)
			} else {
				pos = [2]float64{pos[0] + (next[0]-pos[0])/d*step, pos[1] + (next[1]-pos[1])/d*step}
			}
			speed = 70
		}
		now := time.Now().UTC()
		switch *proto {
		case "gt06":
			serial++
			acc := !cut.Load() && !*park
			send(c, gt06Packet(0x22, gt06Location(now, pos, speed, acc), serial))
			serial++
			send(c, gt06Packet(0x13, gt06Heartbeat(acc, cut.Load()), serial))
		case "h02":
			send(c, []byte(h02Frame(*imei, now, pos, speed)))
		}
		log.Printf("report lat=%.5f lon=%.5f speed=%.0f engine_cut=%v", pos[0], pos[1], speed, cut.Load())
	}
}

func send(c net.Conn, b []byte) {
	if _, err := c.Write(b); err != nil {
		log.Fatalf("write: %v", err)
	}
}

func gt06Reader(c net.Conn, cut *atomic.Bool) {
	r := bufio.NewReader(c)
	for {
		var head [3]byte
		if _, err := io.ReadFull(r, head[:]); err != nil {
			log.Fatalf("gateway closed the connection: %v (is the IMEI registered?)", err)
		}
		body := make([]byte, int(head[2])+2)
		if _, err := io.ReadFull(r, body); err != nil {
			log.Fatal(err)
		}
		if body[0] != 0x80 {
			continue // acknowledgements
		}
		cmd := string(body[6 : len(body)-6])
		log.Printf("command received: %s", cmd)
		switch strings.ToLower(cmd) {
		case "relay,1#":
			cut.Store(true)
		case "relay,0#":
			cut.Store(false)
		}
		reply := append([]byte{byte(4 + len(cmd) + 3), 0, 0, 0, 1}, []byte(cmd+" OK")...)
		send(c, gt06Packet(0x15, reply, binary.BigEndian.Uint16(body[len(body)-6:])))
	}
}

func bcdIMEI(imei string) []byte {
	b, _ := hex.DecodeString(fmt.Sprintf("%016s", imei))
	return b
}

func gt06Location(t time.Time, p [2]float64, speed float64, acc bool) []byte {
	b := []byte{byte(t.Year() - 2000), byte(t.Month()), byte(t.Day()), byte(t.Hour()), byte(t.Minute()), byte(t.Second()), 0xC9}
	b = binary.BigEndian.AppendUint32(b, uint32(p[0]*1800000))
	b = binary.BigEndian.AppendUint32(b, uint32(p[1]*1800000))
	b = append(b, byte(speed), 0x14, 0x00)               // GPS fixed, north, east, course 0
	b = append(b, 0x01, 0xB0, 0x0B, 0x00, 0x01, 0, 0, 1) // LBS: MCC 432 (Iran)
	accByte := byte(0)
	if acc {
		accByte = 1
	}
	return append(b, accByte, 0x00, 0x00)
}

func gt06Heartbeat(acc, cut bool) []byte {
	info := byte(0x40)
	if acc {
		info |= 0x02
	}
	if cut {
		info |= 0x80
	}
	return []byte{info, 0x05, 0x04, 0x00, 0x02}
}

func gt06Packet(proto byte, info []byte, serial uint16) []byte {
	body := []byte{byte(1 + len(info) + 4), proto}
	body = append(body, info...)
	body = binary.BigEndian.AppendUint16(body, serial)
	body = binary.BigEndian.AppendUint16(body, crcITU(body))
	return append(append([]byte{0x78, 0x78}, body...), 0x0D, 0x0A)
}

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

func h02Frame(id string, t time.Time, p [2]float64, kmh float64) string {
	dm := func(v float64) float64 { d := math.Floor(v); return d*100 + (v-d)*60 }
	return fmt.Sprintf("*HQ,%s,V1,%s,A,%09.4f,N,%010.4f,E,%06.2f,000,%s,FFFFFBFF#",
		id, t.Format("150405"), dm(p[0]), dm(p[1]), kmh/1.852, t.Format("020106"))
}
