-- Bloque 3, entrega 3b (Sistema Empire, «sí» de Patricia del 4-nov-2026): el cronograma operativo del manual (sección 9 del
-- Documento maestro) como plantilla editable de la firma, que genera las tareas de cada mes; y las fechas de la ficha para las
-- alertas del registro mercantil, el nombre comercial (ONAPI) y la asamblea ordinaria anual.

-- ───── Fechas nuevas en la ficha (decisión de Patricia del 4-nov: alerta 60 días antes) ─────
ALTER TABLE empresas
  ADD COLUMN vence_registro_mercantil date,
  ADD COLUMN vence_nombre_comercial date,
  ADD COLUMN fecha_asamblea date;

-- ───── Cronograma de la firma ─────
-- alcance: «firma» = una tarea para la firma; «todos» = una por cliente activo; «tss» = una por cliente con TSS; «iguala» = una
-- por cliente fijo con iguala. dia_semana (1 = lunes … 7 = domingo) hace la tarea semanal; si no, va de dia_desde a dia_hasta.
CREATE TABLE plantillas_tarea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  orden int NOT NULL DEFAULT 0,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 200),
  dia_desde int CHECK (dia_desde BETWEEN 1 AND 31),
  dia_hasta int CHECK (dia_hasta BETWEEN 1 AND 31),
  dia_semana int CHECK (dia_semana BETWEEN 1 AND 7),
  alcance text NOT NULL DEFAULT 'firma' CHECK (alcance IN ('firma', 'todos', 'tss', 'iguala')),
  activa boolean NOT NULL DEFAULT true,
  CHECK ((dia_semana IS NOT NULL) <> (dia_desde IS NOT NULL AND dia_hasta IS NOT NULL)),
  CHECK (dia_desde IS NULL OR dia_desde <= dia_hasta)
);

CREATE TABLE tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  plantilla_id uuid REFERENCES plantillas_tarea(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES empresas(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  desde date NOT NULL,
  hasta date NOT NULL,
  periodo text NOT NULL,            -- AAAA-MM (mensual) o AAAA-MM-DD (semanal): una sola vez por plantilla, cliente y período
  responsable_id uuid REFERENCES usuarios(id),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'hecha')),
  hecha_por uuid REFERENCES usuarios(id),
  hecha_en timestamptz,
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (hasta >= desde)
);
CREATE UNIQUE INDEX tareas_una_vez_idx ON tareas(plantilla_id, COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid), periodo)
  WHERE plantilla_id IS NOT NULL;
CREATE INDEX tareas_firma_idx ON tareas(firma_id, desde);

-- El cronograma del manual (orden según la tabla de la sección 9; Patricia lo ajusta en pantalla).
CREATE FUNCTION crear_plantillas_tarea(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_tarea (firma_id, orden, titulo, dia_desde, dia_hasta, dia_semana, alcance)
  SELECT fid, x.orden, x.titulo, x.desde, x.hasta, x.semana, x.alcance
    FROM (VALUES
      (1, 'Saludo en los grupos de contabilidad', NULL::int, NULL::int, 1, 'firma'),
      (2, 'Revisar igualas del mes, acuerdos especiales y vencimientos', 25, 27, NULL, 'firma'),
      (3, 'Emitir facturas de igualas y recurrentes; crear cuentas por cobrar', 30, 30, NULL, 'firma'),
      (4, 'Enviar notificación de pago de la TSS', 1, 3, NULL, 'tss'),
      (5, 'Enviar estado de cuenta y cobrar la iguala', 1, 5, NULL, 'iguala'),
      (6, 'Solicitar facturas de compras para el 606 y dar seguimiento', 1, 10, NULL, 'todos'),
      (7, 'Confirmar documentos y entregarlos a la socia para digitar', 10, 15, NULL, 'firma'),
      (8, 'Enviar constancias de declaraciones e ITBIS con fecha límite', 15, 20, NULL, 'todos'),
      (9, 'Recopilar información del reporte mensual', 25, 30, NULL, 'firma'),
      (10, 'Agenda de la semana siguiente', NULL, NULL, 5, 'firma')
    ) AS x(orden, titulo, desde, hasta, semana, alcance)
   WHERE NOT EXISTS (SELECT 1 FROM plantillas_tarea WHERE firma_id = fid);
$$;

SELECT crear_plantillas_tarea(id) FROM firmas;
