// End-to-end smoke test against a running stack. Exercises the real path:
// app API -> PostgreSQL -> EMQX -> device -> EMQX -> API -> app.
//
//   node scripts/smoke.mjs [http://localhost:8080] [tcp://localhost:1883]
//
// Requires backend/bin/devsim (go build -o backend/bin/devsim ./cmd/devsim).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API = process.argv[2] ?? 'http://localhost:8080';
const BROKER = process.argv[3] ?? 'tcp://localhost:1883';
const devsim = path.resolve('backend/bin', process.platform === 'win32' ? 'devsim.exe' : 'devsim');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  return null;
}

const run = Date.now().toString(36);
const password = 'Sm0keTest-Passw0rd';

// --- accounts
const owner = await call('POST', '/v1/auth/register', null, { email: `owner-${run}@smoke.test`, full_name: 'مالک تست', password });
ok(owner.status === 201, 'owner registers');
const T = owner.body.tokens.access_token;

const weak = await call('POST', '/v1/auth/register', null, { email: `weak-${run}@smoke.test`, full_name: 'ضعیف', password: 'short' });
ok(weak.status === 400 && weak.body.error.code === 'weak_password', 'weak password rejected');

const bad = await call('POST', '/v1/auth/login', null, { email: `owner-${run}@smoke.test`, password: 'Wrong-Passw0rd' });
ok(bad.status === 401, 'wrong password rejected');

ok((await call('GET', '/v1/me', 'not-a-token')).status === 401, 'forged token rejected');

// --- refresh rotation + reuse detection
const r1 = await call('POST', '/v1/auth/refresh', null, { refresh_token: owner.body.tokens.refresh_token });
ok(r1.status === 200, 'refresh token rotates');
const reuse = await call('POST', '/v1/auth/refresh', null, { refresh_token: owner.body.tokens.refresh_token });
ok(reuse.status === 401, 'reused refresh token rejected');
const r2 = await call('POST', '/v1/auth/refresh', null, { refresh_token: r1.body.tokens.refresh_token });
ok(r2.status === 401, 'reuse revoked the whole session family');

// --- site + device
const site = await call('POST', '/v1/sites', T, { name: 'سایت تست', kind: 'home' });
ok(site.status === 201, 'site created with default rooms');
const S = site.body.id;
const rooms = await call('GET', `/v1/sites/${S}/rooms`, T);
ok(rooms.body.rooms.length === 3, 'default rooms present');

const created = await call('POST', `/v1/sites/${S}/devices`, T, { name: 'چراغ', kind: 'light', protocol: 'native', room_id: rooms.body.rooms[0].id });
ok(created.status === 201 && created.body.credentials.mqtt_password, 'device created, credentials issued once');
const D = created.body.device.id;
const creds = created.body.credentials;

// --- device connects over MQTT with its own credentials
if (!existsSync(devsim)) throw new Error(`build the simulator first: ${devsim}`);
const bogus = spawn(devsim, ['-broker', BROKER, '-user', creds.mqtt_username, '-pass', 'wrong-secret']);
const bogusExit = await new Promise((r) => { bogus.on('exit', r); setTimeout(() => { bogus.kill(); r('timeout'); }, 8000); });
ok(bogusExit !== 'timeout' && bogusExit !== 0, 'device with wrong secret refused by broker');

const sim = spawn(devsim, ['-broker', BROKER, '-user', creds.mqtt_username, '-pass', creds.mqtt_password, '-kind', 'light']);
sim.stdout.on('data', () => {});
sim.stderr.on('data', () => {});

const online = await waitFor(async () => (await call('GET', `/v1/sites/${S}/devices/${D}`, T)).body.online);
ok(online, 'device reports online through the broker');

// --- command round trip
const cmd = await call('POST', `/v1/sites/${S}/devices/${D}/commands`, T, { on: true, brightness: 40 });
ok(cmd.status === 202, 'command accepted');
const applied = await waitFor(async () => {
  const d = (await call('GET', `/v1/sites/${S}/devices/${D}`, T)).body;
  return d.state.on === true && d.state.brightness === 40;
});
ok(applied, 'device applied command and reported new state');

const evil = await call('POST', `/v1/sites/${S}/devices/${D}/commands`, T, { exec: 'reboot' });
ok(evil.status === 400, 'unknown command field rejected');

// --- tenant isolation + invites
const other = await call('POST', '/v1/auth/register', null, { email: `member-${run}@smoke.test`, full_name: 'عضو تست', password });
const M = other.body.tokens.access_token;
ok((await call('GET', `/v1/sites/${S}/devices`, M)).status === 404, 'non-member cannot see the site');

const inv = await call('POST', `/v1/sites/${S}/invites`, T, { role: 'member' });
ok(inv.status === 201 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(inv.body.code), 'invite code created');
const joined = await call('POST', '/v1/invites/redeem', M, { code: inv.body.code.toLowerCase().replace('-', ' ') });
ok(joined.status === 200 && joined.body.role === 'member', 'member joined with invite code');
ok((await call('POST', '/v1/invites/redeem', M, { code: inv.body.code })).status === 404, 'invite code is single-use');

ok((await call('GET', `/v1/sites/${S}/devices`, M)).status === 200, 'member sees devices');
ok((await call('POST', `/v1/sites/${S}/devices/${D}/commands`, M, { on: false })).status === 202, 'member can control devices');
ok((await call('DELETE', `/v1/sites/${S}/devices/${D}`, M)).status === 403, 'member cannot delete devices');
ok((await call('POST', `/v1/sites/${S}/invites`, M, { role: 'admin' })).status === 403, 'member cannot create invites');

const me = await call('GET', '/v1/me', T);
ok((await call('DELETE', `/v1/sites/${S}/members/${me.body.id}`, T)).status === 409, 'last owner cannot leave');

// --- credential rotation disconnects the old secret
const rot = await call('POST', `/v1/sites/${S}/devices/${D}/credentials`, T);
ok(rot.status === 200 && rot.body.mqtt_password !== creds.mqtt_password, 'device credentials rotated');

sim.kill();

// --- cellular GPS trackers (GT06 over TCP)
const TRACKER_HOST = process.argv[4] ?? 'localhost';
const GT06_ADDR = process.env.GT06_ADDR ?? `${TRACKER_HOST}:5023`;
const trackersim = path.resolve('backend/bin', process.platform === 'win32' ? 'trackersim.exe' : 'trackersim');
const imei = (n) => `35${Date.now().toString().slice(-9)}${n}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`.slice(0, 15);

const ghost = spawn(trackersim, ['-addr', GT06_ADDR, '-imei', imei(1), '-every', '1s']);
const ghostExit = await new Promise((r) => { ghost.on('exit', r); setTimeout(() => { ghost.kill(); r('timeout'); }, 8000); });
ok(ghostExit !== 'timeout', 'unregistered tracker IMEI is disconnected');

const carIMEI = imei(2);
const car = await call('POST', `/v1/sites/${S}/devices`, T, { name: 'پژو ۲۰۶', kind: 'tracker', protocol: 'gt06', external_id: carIMEI, room_id: null });
ok(car.status === 201 && car.body.credentials === null, 'tracker registered by IMEI (no MQTT key)');
const dup = await call('POST', `/v1/sites/${S}/devices`, T, { name: 'تکراری', kind: 'tracker', protocol: 'gt06', external_id: carIMEI, room_id: null });
ok(dup.status === 409, 'same IMEI cannot be registered twice');
const C = car.body.device.id;

const driving = spawn(trackersim, ['-addr', GT06_ADDR, '-imei', carIMEI, '-every', '1s']);
driving.stderr.on('data', () => {});
const moving = await waitFor(async () => {
  const d = (await call('GET', `/v1/sites/${S}/devices/${C}`, T)).body;
  return d.online && d.state.lat > 35 && d.state.speed > 0 && d.state.ignition === true ? d : null;
});
ok(moving, 'tracker online, position in Tehran, speed and ignition reported');
const refused = await call('POST', `/v1/sites/${S}/devices/${C}/commands`, T, { immobilized: true });
ok(refused.status === 409 && refused.body.error.code === 'vehicle_moving', 'engine cut refused while moving');

const parkedIMEI = imei(3);
const parkedCar = await call('POST', `/v1/sites/${S}/devices`, T, { name: 'وانت', kind: 'tracker', protocol: 'gt06', external_id: parkedIMEI, room_id: null });
const P = parkedCar.body.device.id;
const parked = spawn(trackersim, ['-addr', GT06_ADDR, '-imei', parkedIMEI, '-every', '1s', '-park']);
let simLog = '';
parked.stderr.on('data', (d) => { simLog += d; });
await waitFor(async () => (await call('GET', `/v1/sites/${S}/devices/${P}`, T)).body.state.lat);
ok((await call('POST', `/v1/sites/${S}/devices/${P}/commands`, M, { immobilized: true })).status === 202, 'engine cut sent to parked vehicle');
const cutAck = await waitFor(async () => (await call('GET', `/v1/sites/${S}/devices/${P}`, T)).body.state.power_cut === true);
ok(cutAck && simLog.includes('Relay,1#'), 'tracker executed engine cut and reported it');

const track = await waitFor(async () => {
  const t = await call('GET', `/v1/sites/${S}/devices/${C}/track?range=24h`, T);
  return t.status === 200 && t.body.points.length >= 3 ? t.body.points : null;
});
ok(track && track[0].lat !== track[track.length - 1].lat, 'route history recorded as the car drives');
driving.kill();
parked.kill();

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
