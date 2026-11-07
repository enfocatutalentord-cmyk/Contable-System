-- Rediseño R2 (Lista de rediseños de Patricia, 6-nov-2026, n.º 6): las tareas de igualas y cobros pasan a Contabilidad Empire.
-- Solo se agrega una marca; no se borra ni se cambia ninguna tarea ya generada.

ALTER TABLE plantillas_tarea ADD COLUMN seccion text NOT NULL DEFAULT 'firma' CHECK (seccion IN ('firma', 'empire'));

-- Del cronograma del manual: revisar igualas, emitir las facturas de igualas y cobrar la iguala.
UPDATE plantillas_tarea SET seccion = 'empire' WHERE titulo ILIKE '%iguala%';

-- Las firmas nuevas reciben el mismo cronograma, con esas tareas ya en Contabilidad Empire.
CREATE OR REPLACE FUNCTION crear_plantillas_tarea(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_tarea (firma_id, orden, titulo, dia_desde, dia_hasta, dia_semana, alcance, seccion)
  SELECT fid, x.orden, x.titulo, x.desde, x.hasta, x.semana, x.alcance, x.seccion
    FROM (VALUES
      (1, 'Saludo en los grupos de contabilidad', NULL::int, NULL::int, 1, 'firma', 'firma'),
      (2, 'Revisar igualas del mes, acuerdos especiales y vencimientos', 25, 27, NULL, 'firma', 'empire'),
      (3, 'Emitir facturas de igualas y recurrentes; crear cuentas por cobrar', 30, 30, NULL, 'firma', 'empire'),
      (4, 'Enviar notificación de pago de la TSS', 1, 3, NULL, 'tss', 'firma'),
      (5, 'Enviar estado de cuenta y cobrar la iguala', 1, 5, NULL, 'iguala', 'empire'),
      (6, 'Solicitar facturas de compras para el 606 y dar seguimiento', 1, 10, NULL, 'todos', 'firma'),
      (7, 'Confirmar documentos y entregarlos a la socia para digitar', 10, 15, NULL, 'firma', 'firma'),
      (8, 'Enviar constancias de declaraciones e ITBIS con fecha límite', 15, 20, NULL, 'todos', 'firma'),
      (9, 'Recopilar información del reporte mensual', 25, 30, NULL, 'firma', 'firma'),
      (10, 'Agenda de la semana siguiente', NULL, NULL, 5, 'firma', 'firma')
    ) AS x(orden, titulo, desde, hasta, semana, alcance, seccion)
   WHERE NOT EXISTS (SELECT 1 FROM plantillas_tarea WHERE firma_id = fid);
$$;
