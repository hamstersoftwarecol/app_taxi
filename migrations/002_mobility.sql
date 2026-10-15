CREATE TABLE IF NOT EXISTS drivers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, plate TEXT NOT NULL, vehicle TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('mini','sedan','suv')), rating NUMERIC NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('available','busy','offline')),
 verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','approved','rejected')),
 license_number TEXT NOT NULL, license_expires_at DATE NOT NULL, verification_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_plate_unique ON drivers(lower(plate));
CREATE TABLE IF NOT EXISTS quotes (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, origin TEXT NOT NULL, destination TEXT NOT NULL,
 origin_lat DOUBLE PRECISION NOT NULL, origin_lng DOUBLE PRECISION NOT NULL,
 destination_lat DOUBLE PRECISION NOT NULL, destination_lng DOUBLE PRECISION NOT NULL,
 category TEXT NOT NULL, fare INTEGER NOT NULL CHECK(fare>0), route JSONB NOT NULL,
 distance_meters INTEGER NOT NULL, duration_seconds INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '5 minutes', consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS trips (
 id TEXT PRIMARY KEY, passenger_id TEXT NOT NULL, passenger TEXT NOT NULL,
 origin TEXT NOT NULL, destination TEXT NOT NULL, category TEXT NOT NULL,
 fare INTEGER NOT NULL CHECK(fare>0), payment TEXT NOT NULL CHECK(payment IN ('Efectivo','Tarjeta')),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','in_progress','completed','cancelled')),
 driver_id TEXT REFERENCES drivers(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), origin_lat DOUBLE PRECISION NOT NULL,
 origin_lng DOUBLE PRECISION NOT NULL, destination_lat DOUBLE PRECISION NOT NULL,
 destination_lng DOUBLE PRECISION NOT NULL, route JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active_driver ON trips(driver_id) WHERE status IN ('accepted','in_progress');
CREATE INDEX IF NOT EXISTS trips_passenger_idx ON trips(passenger_id,created_at DESC);
CREATE TABLE IF NOT EXISTS locations (
 driver_id TEXT PRIMARY KEY REFERENCES drivers(id), lat DOUBLE PRECISION NOT NULL CHECK(lat BETWEEN -90 AND 90),
 lng DOUBLE PRECISION NOT NULL CHECK(lng BETWEEN -180 AND 180), accuracy DOUBLE PRECISION NOT NULL CHECK(accuracy>=0),
 recorded_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
