// Command devsim behaves like a real Hooshban (native protocol) device.
// Operators use it to verify a site end-to-end before real hardware is
// installed; it is also how the platform is tested without an ESP32.
//
//	devsim -broker tcp://localhost:1883 -user <mqtt_username> -pass <mqtt_password> -kind light
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand/v2"
	"os"
	"os/signal"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

func main() {
	broker := flag.String("broker", "tcp://localhost:1883", "MQTT broker URL (tcp:// or ssl://)")
	user := flag.String("user", "", "mqtt_username shown when the device was added ({siteID}.{deviceID})")
	pass := flag.String("pass", "", "mqtt_password shown when the device was added")
	kind := flag.String("kind", "light", "light | plug | sensor | thermostat | switch")
	flag.Parse()

	siteID, deviceID, ok := strings.Cut(*user, ".")
	if !ok || *pass == "" {
		flag.Usage()
		os.Exit(2)
	}
	root := fmt.Sprintf("hb/%s/%s", siteID, deviceID)

	dev := &device{root: root, kind: *kind, state: initialState(*kind)}

	opts := mqtt.NewClientOptions().
		AddBroker(*broker).
		SetClientID(*user). // the broker requires client ID == username
		SetUsername(*user).
		SetPassword(*pass).
		SetAutoReconnect(true). // after the first successful connect
		SetConnectTimeout(10*time.Second).
		SetWill(root+"/status", "offline", 1, true).
		SetOnConnectHandler(func(c mqtt.Client) {
			log.Printf("connected, topic root %s", root)
			dev.client = c
			c.Publish(root+"/status", 1, true, "online").Wait()
			if t := c.Subscribe(root+"/cmd", 1, dev.onCommand); t.Wait() && t.Error() != nil {
				log.Printf("subscribe failed: %v", t.Error())
			}
			dev.publish()
		}).
		SetConnectionLostHandler(func(_ mqtt.Client, err error) { log.Printf("connection lost: %v", err) })

	c := mqtt.NewClient(opts)
	if t := c.Connect(); t.Wait() && t.Error() != nil {
		log.Fatalf("connect: %v (check username/password and that the device was not deleted)", t.Error())
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	tick := time.NewTicker(10 * time.Second)
	for {
		select {
		case <-stop:
			c.Publish(root+"/status", 1, true, "offline").Wait()
			c.Disconnect(500)
			return
		case <-tick.C:
			dev.drift()
			dev.publish()
		}
	}
}

type device struct {
	mu     sync.Mutex
	client mqtt.Client
	root   string
	kind   string
	state  map[string]any
}

func initialState(kind string) map[string]any {
	switch kind {
	case "light":
		return map[string]any{"on": false, "brightness": 70.0}
	case "plug":
		return map[string]any{"on": false, "power": 0.0, "energy": 0.0}
	case "sensor":
		return map[string]any{"temperature": 23.0, "humidity": 40.0, "battery": 95.0}
	case "thermostat":
		return map[string]any{"on": true, "target_temperature": 22.0, "temperature": 21.0}
	default:
		return map[string]any{"on": false}
	}
}

func (d *device) onCommand(_ mqtt.Client, m mqtt.Message) {
	var cmd map[string]any
	if err := json.Unmarshal(m.Payload(), &cmd); err != nil {
		log.Printf("bad command: %s", m.Payload())
		return
	}
	log.Printf("command: %s", m.Payload())
	d.mu.Lock()
	for k, v := range cmd {
		d.state[k] = v
	}
	d.mu.Unlock()
	d.drift()
	d.publish()
}

// drift makes readings move like real hardware.
func (d *device) drift() {
	d.mu.Lock()
	defer d.mu.Unlock()
	round := func(f float64) float64 { return math.Round(f*10) / 10 }
	switch d.kind {
	case "plug":
		if d.state["on"] == true {
			p := 120 + rand.Float64()*40
			d.state["power"] = round(p)
			d.state["energy"] = round(d.state["energy"].(float64) + p*10/3600/1000)
		} else {
			d.state["power"] = 0.0
		}
	case "sensor":
		d.state["temperature"] = round(d.state["temperature"].(float64) + (rand.Float64()-0.5)*0.3)
		d.state["humidity"] = round(math.Max(10, math.Min(90, d.state["humidity"].(float64)+(rand.Float64()-0.5))))
	case "thermostat":
		t := d.state["temperature"].(float64)
		if target, ok := d.state["target_temperature"].(float64); ok && d.state["on"] == true {
			t += (target - t) * 0.2
		}
		d.state["temperature"] = round(t)
	}
}

func (d *device) publish() {
	d.mu.Lock()
	b, _ := json.Marshal(d.state)
	c := d.client
	d.mu.Unlock()
	if c == nil {
		return
	}
	c.Publish(d.root+"/state", 1, true, b)
}
