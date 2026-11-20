-- Prioridad 1.5 del prompt de Patricia (20-nov-2026): trámites que se crean desde «Trámites abiertos», con tiempo en días laborables,
-- estados, notas con fecha, pendientes que se tachan, adjuntos y plantillas que guardan sus pasos y tiempos. Nada se borra: los trámites
-- que ya existían pasan a «En espera de respuesta» (abiertos) o «Completado» (cerrados).

ALTER TABLE tramites
  ADD COLUMN etapa text NOT NULL DEFAULT 'pendiente' CHECK (etapa IN ('pendiente', 'en_proceso', 'en_espera', 'completado')),
  ADD COLUMN espera_motivo text CHECK (length(espera_motivo) <= 300),
  ADD COLUMN espera_dias int CHECK (espera_dias BETWEEN 1 AND 365),
  ADD COLUMN espera_desde date,
  ADD COLUMN dias_estimados int CHECK (dias_estimados BETWEEN 1 AND 365),
  ADD COLUMN plantilla_id uuid;
UPDATE tramites SET etapa = CASE WHEN estado = 'cerrado' THEN 'completado' ELSE 'en_espera' END,
                    espera_desde = CASE WHEN estado = 'abierto' THEN fecha END;
GRANT UPDATE (etapa, espera_motivo, espera_dias, espera_desde, dias_estimados, plantilla_id) ON tramites TO contable_app;

-- Notas con fecha («falta la clave», «falta el correo») y pendientes que se tachan. Cada pendiente puede tener su día (laborable, contado
-- desde el inicio del trámite) para avisar cuando toca ese paso.
CREATE TABLE notas_tramite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  fecha date NOT NULL DEFAULT current_date,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 1000),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notas_tramite_idx ON notas_tramite(tramite_id, creado);

CREATE TABLE pendientes_tramite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tramite_id uuid NOT NULL REFERENCES tramites(id) ON DELETE CASCADE,
  orden int NOT NULL DEFAULT 0,
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 300),
  dia int CHECK (dia BETWEEN 0 AND 365),         -- día laborable del paso, contado desde el inicio
  vence date,                                     -- calculado al crearlo
  hecho boolean NOT NULL DEFAULT false,
  hecho_por uuid REFERENCES usuarios(id),
  hecho_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pendientes_tramite_idx ON pendientes_tramite(tramite_id, orden);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notas_tramite', 'pendientes_tramite'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- Plantillas de trámite por firma: la primera vez se guarda con sus pasos y tiempos; la próxima solo se elige. Como plantillas_tarea,
-- sin RLS y siempre filtrada por firma.
CREATE TABLE plantillas_tramite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
  institucion text NOT NULL DEFAULT 'otra' CHECK (institucion IN ('dgii', 'tss', 'camara', 'onapi', 'otra')),
  dias_estimados int NOT NULL CHECK (dias_estimados BETWEEN 1 AND 365),
  pasos jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ "texto": "...", "dia": 3 }]
  creado_por uuid REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firma_id, nombre)
);
ALTER TABLE tramites ADD CONSTRAINT tramites_plantilla_fk FOREIGN KEY (plantilla_id) REFERENCES plantillas_tramite(id) ON DELETE SET NULL;

-- Feriados para contar los días laborables (respuesta recomendada 6: lunes a viernes sin los feriados oficiales). Vienen los de 2026 según
-- el calendario del Ministerio de Trabajo (Ley 139-97, con los traslados); la firma los edita.
CREATE TABLE feriados (
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
  PRIMARY KEY (firma_id, fecha)
);
CREATE FUNCTION crear_feriados(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO feriados (firma_id, fecha, nombre) VALUES
    (fid, '2026-01-01', 'Año Nuevo'), (fid, '2026-01-05', 'Día de los Santos Reyes (trasladado)'), (fid, '2026-01-21', 'Día de la Altagracia'),
    (fid, '2026-01-26', 'Día de Duarte'), (fid, '2026-02-27', 'Día de la Independencia'), (fid, '2026-04-03', 'Viernes Santo'),
    (fid, '2026-05-04', 'Día del Trabajo (trasladado)'), (fid, '2026-06-04', 'Corpus Christi'), (fid, '2026-08-16', 'Día de la Restauración'),
    (fid, '2026-09-24', 'Día de las Mercedes'), (fid, '2026-11-09', 'Día de la Constitución (trasladado)'), (fid, '2026-12-25', 'Navidad')
  ON CONFLICT DO NOTHING;
$$;
SELECT crear_feriados(id) FROM firmas;

-- Bitácora: igual que antes; un trámite sin institución (los nuevos de «+ Nuevo trámite») dice solo «Trámite».
CREATE OR REPLACE FUNCTION gestion_tramite() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inst text := CASE NEW.institucion WHEN 'dgii' THEN 'DGII' WHEN 'tss' THEN 'TSS' WHEN 'camara' THEN 'Cámara de Comercio' WHEN 'onapi' THEN 'ONAPI' ELSE NULL END;
        que text := COALESCE('Trámite ante ' || inst, 'Trámite');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM anotar_gestion(NEW.empresa_id, NEW.fecha, 'tramite', que || ': ' || NEW.tipo ||
      COALESCE(' (n.º ' || NEW.numero || ')', '') || ', respuesta a más tardar el ' || to_char(NEW.plazo, 'DD/MM/YYYY'), 'tramite', NEW.id);
  ELSIF OLD.estado = 'abierto' AND NEW.estado = 'cerrado' THEN
    PERFORM anotar_gestion(NEW.empresa_id, current_date, 'tramite', que || ' cerrado: ' || NEW.tipo ||
      COALESCE(' · ' || NEW.respuesta, ''), 'tramite_cierre', NEW.id);
  END IF;
  RETURN NULL;
END $$;

-- Hasta cuándo se espera la respuesta (días laborables desde que se puso «En espera»), para avisar al vencer.
ALTER TABLE tramites ADD COLUMN espera_hasta date;
GRANT UPDATE (espera_hasta) ON tramites TO contable_app;
GRANT SELECT ON feriados TO contable_app;
