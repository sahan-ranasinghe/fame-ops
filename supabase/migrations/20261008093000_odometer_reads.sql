-- =============================================================================
-- odometer_reads: one row per call of the Edge Function read-odometer (the
-- AI that reads the odometer from a photo). Used for the daily limit per
-- driver and to see how well the reader does. Written only by the function
-- (service_role); drivers and the connector do not read it.
-- =============================================================================

create table public.odometer_reads (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees (id),
  vehicle_id   uuid references public.vehicles (id),
  photo_path   text not null,
  -- What the app said it expected: the vehicle's last reading and the km driven since (GPS).
  last_km      integer,
  gps_km       real,
  -- What the model answered, before the range check; rejected says why it was not offered to the driver.
  reading_km   integer,
  confidence   real,
  rejected     text,
  model        text not null,
  ok           boolean not null default true,
  error        text,
  raw          text,
  ms           integer,
  created_at   timestamptz not null default now(),
  constraint odometer_reads_rejected_check check (rejected in ('below_last', 'far_above', 'unreadable'))
);

create index odometer_reads_employee_created_idx on public.odometer_reads (employee_id, created_at desc);

alter table public.odometer_reads enable row level security;
-- No policies: only service_role (the Edge Function) reaches this table.
revoke all on public.odometer_reads from public, anon, authenticated;
