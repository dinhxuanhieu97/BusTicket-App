CREATE TABLE trip_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id),
  name text NOT NULL,
  config jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operator_id, id)
);
CREATE INDEX trip_schedules_due_idx ON trip_schedules(next_run_at) WHERE enabled;
CREATE TABLE trip_schedule_exceptions (
  schedule_id uuid NOT NULL REFERENCES trip_schedules(id),
  service_date date NOT NULL,
  leg integer NOT NULL CHECK (leg IN (0,1)),
  skipped boolean NOT NULL DEFAULT false,
  depart_time text CHECK (depart_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  PRIMARY KEY (schedule_id,service_date,leg)
);
ALTER TABLE trips ADD COLUMN schedule_id uuid,
  ADD COLUMN service_date date,
  ADD COLUMN schedule_leg integer,
  ADD COLUMN occupied_until timestamptz;
CREATE UNIQUE INDEX trips_schedule_occurrence_idx ON trips(schedule_id,service_date,schedule_leg) WHERE schedule_id IS NOT NULL;
CREATE INDEX trips_vehicle_depart_idx ON trips(operator_id,vehicle_id,depart_at);
ALTER TABLE operators ADD COLUMN default_departure_time text NOT NULL DEFAULT '17:30'
 CHECK (default_departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE trips ADD COLUMN planned_arrive_at timestamptz, ADD COLUMN stops_snapshot jsonb,
  ADD FOREIGN KEY (operator_id,schedule_id) REFERENCES trip_schedules(operator_id,id),
  ADD CONSTRAINT trips_schedule_metadata CHECK (
    (schedule_id IS NULL AND service_date IS NULL AND schedule_leg IS NULL)
    OR (schedule_id IS NOT NULL AND service_date IS NOT NULL AND schedule_leg IS NOT NULL
        AND schedule_leg IN (0,1) AND occupied_until IS NOT NULL AND occupied_until > depart_at
        AND planned_arrive_at IS NOT NULL AND planned_arrive_at > depart_at AND stops_snapshot IS NOT NULL)
  );
ALTER TABLE trip_schedules ADD COLUMN create_key uuid, ADD UNIQUE (operator_id, create_key);
