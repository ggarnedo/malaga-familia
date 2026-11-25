-- Málaga en familia · base de datos compartida (Supabase)
-- Pega este archivo entero en Supabase > SQL Editor y pulsa Run.
-- ANTES de ejecutarlo, cambia la clave familiar en la línea marcada con >>>.
--
-- Seguridad: las tablas no se pueden leer ni escribir directamente desde la web.
-- Todo pasa por funciones que comprueban la clave familiar.

create extension if not exists pgcrypto with schema extensions;

-- ── Tablas ────────────────────────────────────────────────────────────────
create table if not exists public.ajustes (
  id int primary key default 1 check (id = 1),
  clave_hash text not null
);

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(btrim(nombre)) between 1 and 40),
  creado timestamptz not null default now()
);

create table if not exists public.votos (
  item text not null check (char_length(item) between 1 and 80),
  persona uuid not null references public.personas(id) on delete cascade,
  valor smallint not null check (valor in (-1, 1)),
  actualizado timestamptz not null default now(),
  primary key (item, persona)
);

create table if not exists public.tareas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  dia text check (dia is null or char_length(dia) <= 20),
  responsable uuid references public.personas(id) on delete set null,
  hecha boolean not null default false,
  creada timestamptz not null default now()
);

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  concepto text not null check (char_length(btrim(concepto)) between 1 and 80),
  importe numeric(10,2) not null check (importe > 0 and importe < 100000),
  pagador uuid not null references public.personas(id) on delete restrict,
  reparto uuid[] not null check (cardinality(reparto) between 1 and 40),
  fecha date not null default current_date,
  creado timestamptz not null default now()
);

alter table public.ajustes  enable row level security;
alter table public.personas enable row level security;
alter table public.votos    enable row level security;
alter table public.tareas   enable row level security;
alter table public.gastos   enable row level security;
revoke all on public.ajustes, public.personas, public.votos, public.tareas, public.gastos from anon, authenticated;

-- ── Clave familiar ────────────────────────────────────────────────────────
-- >>> Cambia 'CAMBIA-ESTA-CLAVE' por la clave que repartirás a la familia.
insert into public.ajustes (id, clave_hash)
values (1, extensions.crypt('CAMBIA-ESTA-CLAVE', extensions.gen_salt('bf')))
on conflict (id) do update set clave_hash = excluded.clave_hash;

create or replace function public._exigir_clave(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_clave is null or not exists (
    select 1 from ajustes where clave_hash = extensions.crypt(p_clave, clave_hash)
  ) then
    raise exception 'clave_incorrecta' using errcode = '28000';
  end if;
end $$;
revoke all on function public._exigir_clave(text) from public, anon, authenticated;

create or replace function public.comprobar_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform pg_sleep(0.3);
  return exists (select 1 from ajustes where clave_hash = extensions.crypt(coalesce(p_clave,''), clave_hash));
end $$;

-- ── Lectura ───────────────────────────────────────────────────────────────
create or replace function public.estado(p_clave text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _exigir_clave(p_clave);
  return json_build_object(
    'personas', (select coalesce(json_agg(json_build_object('id', id, 'nombre', nombre) order by nombre), '[]'::json) from personas),
    'votos',    (select coalesce(json_agg(json_build_object('item', item, 'persona', persona, 'valor', valor)), '[]'::json) from votos),
    'tareas',   (select coalesce(json_agg(json_build_object('id', id, 'titulo', titulo, 'dia', dia, 'responsable', responsable, 'hecha', hecha) order by hecha, creada), '[]'::json) from tareas),
    'gastos',   (select coalesce(json_agg(json_build_object('id', id, 'concepto', concepto, 'importe', importe, 'pagador', pagador, 'reparto', reparto, 'fecha', fecha) order by fecha desc, creado desc), '[]'::json) from gastos)
  );
end $$;

-- ── Personas ──────────────────────────────────────────────────────────────
create or replace function public.alta_persona(p_clave text, p_nombre text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform _exigir_clave(p_clave);
  insert into personas (nombre) values (btrim(p_nombre))
  on conflict (nombre) do update set nombre = excluded.nombre
  returning id into v_id;
  return v_id;
end $$;

-- ── Votos ─────────────────────────────────────────────────────────────────
create or replace function public.votar(p_clave text, p_item text, p_persona uuid, p_valor smallint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _exigir_clave(p_clave);
  if p_valor = 0 then
    delete from votos where item = p_item and persona = p_persona;
  else
    insert into votos (item, persona, valor) values (p_item, p_persona, p_valor)
    on conflict (item, persona) do update set valor = excluded.valor, actualizado = now();
  end if;
end $$;

-- ── Tareas ────────────────────────────────────────────────────────────────
create or replace function public.crear_tarea(p_clave text, p_titulo text, p_dia text, p_responsable uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform _exigir_clave(p_clave);
  insert into tareas (titulo, dia, responsable) values (btrim(p_titulo), nullif(p_dia, ''), p_responsable)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.actualizar_tarea(p_clave text, p_id uuid, p_hecha boolean, p_responsable uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _exigir_clave(p_clave);
  update tareas set hecha = p_hecha, responsable = p_responsable where id = p_id;
end $$;

create or replace function public.borrar_tarea(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _exigir_clave(p_clave);
  delete from tareas where id = p_id;
end $$;

-- ── Gastos ────────────────────────────────────────────────────────────────
create or replace function public.crear_gasto(p_clave text, p_concepto text, p_importe numeric, p_pagador uuid, p_reparto uuid[], p_fecha date) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform _exigir_clave(p_clave);
  insert into gastos (concepto, importe, pagador, reparto, fecha)
  values (btrim(p_concepto), round(p_importe, 2), p_pagador, p_reparto, coalesce(p_fecha, current_date))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.borrar_gasto(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _exigir_clave(p_clave);
  delete from gastos where id = p_id;
end $$;

grant execute on function
  public.comprobar_clave(text),
  public.estado(text),
  public.alta_persona(text, text),
  public.votar(text, text, uuid, smallint),
  public.crear_tarea(text, text, text, uuid),
  public.actualizar_tarea(text, uuid, boolean, uuid),
  public.borrar_tarea(text, uuid),
  public.crear_gasto(text, text, numeric, uuid, uuid[], date),
  public.borrar_gasto(text, uuid)
to anon;

-- ── Tareas iniciales (solo si la lista está vacía) ───────────────────────
insert into public.tareas (titulo, dia)
select t, d from (values
  ('Comprar entradas de la Alcazaba (franja 11:00, tarifa de grupo)', 'Mar 29'),
  ('Comprar entradas de la Catedral', 'Mar 29'),
  ('Comprar entradas de las Luces del Botánico cuando abra la venta', 'Mar 29'),
  ('Decidir la cena de Nochevieja (chef o catering)', 'Jue 31'),
  ('Reservar El Tintero para 15', 'Vie 1'),
  ('Reservar la comida de despedida para 15', 'Sáb 2'),
  ('Compra de desayunos para toda la semana', 'Lun 28'),
  ('Cotillón, uvas y cava para Nochevieja', 'Jue 31')
) as v(t, d)
where not exists (select 1 from public.tareas);
