package tracker

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"
)

const (
	idleTimeout  = 10 * time.Minute // trackers heartbeat every 1-5 minutes
	loginTimeout = 30 * time.Second
	writeTimeout = 10 * time.Second
	maxConns     = 100_000
	maxPerIP     = 50 // many trackers can sit behind one carrier NAT address
)

var ErrNotConnected = errors.New("tracker is not connected")

type conn struct {
	c     net.Conn
	codec codec
	mu    sync.Mutex // serialises writes and session state
	sess  session
}

// Gateway serves one TCP port per tracker protocol.
type Gateway struct {
	sink Sink

	mu    sync.Mutex
	conns map[string]*conn // protocol + ":" + imei
	perIP map[string]int
	total int
}

func NewGateway(sink Sink) *Gateway {
	return &Gateway{sink: sink, conns: map[string]*conn{}, perIP: map[string]int{}}
}

// Listen serves protocol on addr until ctx is cancelled.
func (g *Gateway) Listen(ctx context.Context, protocol, addr string) error {
	cd, ok := codecs[protocol]
	if !ok {
		return fmt.Errorf("unknown tracker protocol %q", protocol)
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	slog.Info("tracker gateway listening", "protocol", protocol, "addr", addr)
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	for {
		c, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			continue
		}
		ip, _, _ := net.SplitHostPort(c.RemoteAddr().String())
		if !g.admit(ip) {
			c.Close()
			continue
		}
		go func() {
			defer g.release(ip)
			g.serve(ctx, protocol, cd, c)
		}()
	}
}

func (g *Gateway) admit(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.total >= maxConns || g.perIP[ip] >= maxPerIP {
		return false
	}
	g.total++
	g.perIP[ip]++
	return true
}

func (g *Gateway) release(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.total--
	if g.perIP[ip]--; g.perIP[ip] <= 0 {
		delete(g.perIP, ip)
	}
}

func (g *Gateway) serve(ctx context.Context, protocol string, cd codec, nc net.Conn) {
	defer nc.Close()
	cn := &conn{c: nc, codec: cd}
	r := bufio.NewReaderSize(nc, 2048)
	key := ""

	defer func() {
		if key == "" {
			return
		}
		g.mu.Lock()
		current := g.conns[key] == cn
		if current {
			delete(g.conns, key)
		}
		g.mu.Unlock()
		if current {
			g.sink.Online(context.Background(), protocol, cn.sess.imei, false)
		}
	}()

	nc.SetReadDeadline(time.Now().Add(loginTimeout))
	for {
		frame, err := cd.readFrame(r)
		if err != nil {
			return
		}
		cn.mu.Lock()
		reports, reply, err := cd.decode(frame, &cn.sess)
		imei := cn.sess.imei
		cn.mu.Unlock()
		if err != nil {
			slog.Debug("tracker frame rejected", "protocol", protocol, "remote", nc.RemoteAddr().String(), "err", err)
			return
		}

		if key == "" && imei != "" {
			// First identification: unknown trackers are dropped immediately.
			if !g.sink.Known(ctx, protocol, imei) {
				slog.Info("unregistered tracker rejected", "protocol", protocol, "id", imei, "remote", nc.RemoteAddr().String())
				return
			}
			key = protocol + ":" + imei
			g.mu.Lock()
			if old := g.conns[key]; old != nil {
				old.c.Close() // a reconnect replaces a stale connection
			}
			g.conns[key] = cn
			g.mu.Unlock()
			g.sink.Online(ctx, protocol, imei, true)
		}
		nc.SetReadDeadline(time.Now().Add(idleTimeout))

		if len(reply) > 0 {
			if err := cn.write(reply); err != nil {
				return
			}
		}
		for _, rep := range reports {
			if err := g.sink.Report(ctx, protocol, imei, rep); err != nil {
				slog.Error("tracker report", "err", err, "id", imei)
			}
		}
	}
}

func (c *conn) write(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.c.SetWriteDeadline(time.Now().Add(writeTimeout))
	_, err := c.c.Write(b)
	return err
}

// Send pushes an action to a tracker connected to this gateway instance.
func (g *Gateway) Send(protocol, imei string, a Action) error {
	g.mu.Lock()
	cn := g.conns[protocol+":"+imei]
	g.mu.Unlock()
	if cn == nil {
		return ErrNotConnected
	}
	cn.mu.Lock()
	b, err := cn.codec.encode(&cn.sess, a)
	cn.mu.Unlock()
	if err != nil {
		return err
	}
	return cn.write(b)
}

// Connected reports whether this instance holds the tracker's connection.
func (g *Gateway) Connected(protocol, imei string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.conns[protocol+":"+imei] != nil
}
