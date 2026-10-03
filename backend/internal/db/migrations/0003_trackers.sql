-- GPS trackers (GT06, H02, ...) identify themselves only by IMEI, so an IMEI
-- may belong to exactly one top-level device per protocol.
CREATE UNIQUE INDEX devices_protocol_external_idx
    ON devices (protocol, external_id)
    WHERE parent_id IS NULL AND external_id IS NOT NULL;

CREATE TABLE positions (
    time        timestamptz      NOT NULL,
    device_id   uuid             NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    lat         double precision NOT NULL,
    lon         double precision NOT NULL,
    speed       real             NOT NULL DEFAULT 0,  -- km/h
    course      smallint         NOT NULL DEFAULT 0,  -- degrees
    satellites  smallint,
    valid       boolean          NOT NULL DEFAULT true,
    ignition    boolean
);
CREATE INDEX positions_device_time_idx ON positions (device_id, time DESC);

DO $$
BEGIN
    PERFORM create_hypertable('positions', 'time', migrate_data => true);
    PERFORM add_retention_policy('positions', INTERVAL '365 days');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb not available, positions stays a plain table';
END $$;
