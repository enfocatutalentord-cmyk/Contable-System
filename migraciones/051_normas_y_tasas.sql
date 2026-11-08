-- Entrega B · Normas y tasas (propuesta del 6-nov-2026, documento Fase 2, sección 7; «sí» de Patricia del 7-nov con las respuestas
-- recomendadas: responsable Patricia, revisión mensual con recordatorio a los 30 días, tasa nueva para todos con opción de quitar).
-- Una ley o norma nueva no se detecta sola: la firma la carga una vez y vale para todos sus clientes, con su fecha de vigencia.

-- Calendario fiscal de la firma: el día del mes siguiente en que vence cada declaración mensual y los días después del cierre del
-- ejercicio para el IR-2. Lo usan las alertas, el tablero de impuestos y el reporte mensual. Se cambia si la DGII mueve una fecha.
CREATE TABLE calendario_fiscal (
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  formato text NOT NULL CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17', 'IR-2')),
  dia int NOT NULL CHECK ((formato = 'IR-2' AND dia BETWEEN 1 AND 365) OR (formato <> 'IR-2' AND dia BETWEEN 1 AND 31)),
  norma text, -- de dónde sale la fecha
  cambiado_por text,
  cambiado_en timestamptz,
  PRIMARY KEY (firma_id, formato)
);

-- Prórrogas: un mes en que la fecha se corre (feriado, aviso de la DGII). Manda sobre el día del calendario.
CREATE TABLE prorrogas_fiscales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  formato text NOT NULL CHECK (formato IN ('606', '607', '608', 'IT-1', 'IR-17', 'IR-2')),
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),
  vence date NOT NULL,
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 300),
  creado_por text,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (firma_id, formato, periodo)
);

CREATE OR REPLACE FUNCTION crear_calendario_fiscal(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO calendario_fiscal (firma_id, formato, dia, norma) VALUES
    (fid, '606', 15, 'Norma General 07-2018, art. 8'), (fid, '607', 15, 'Norma General 07-2018, art. 8'),
    (fid, '608', 15, 'Norma General 07-2018, art. 8'), (fid, 'IT-1', 20, 'Ley 11-92 (Código Tributario), art. 353'),
    (fid, 'IR-17', 10, 'Ley 11-92 (Código Tributario), art. 309'), (fid, 'IR-2', 120, 'Ley 11-92 (Código Tributario), art. 299')
  ON CONFLICT DO NOTHING;
$$;
SELECT crear_calendario_fiscal(id) FROM firmas;

-- Vencimiento de una declaración de la empresa en curso: la prórroga de ese mes si la hay; si no, el día del calendario de su firma en
-- el mes siguiente al período (sin pasar del último día) o, para el IR-2, los días después del cierre del ejercicio (período = mes de
-- cierre, AAAAMM). SECURITY DEFINER: el rol de la aplicación no lee las tablas de la firma.
CREATE FUNCTION vencimiento_fiscal(f text, periodo text) RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fid uuid := (SELECT firma_id FROM empresas WHERE id = empresa_actual());
  p date;
  d int;
  inicio date := to_date(periodo || '01', 'YYYYMMDD');
BEGIN
  SELECT vence INTO p FROM prorrogas_fiscales WHERE firma_id = fid AND formato = f AND prorrogas_fiscales.periodo = vencimiento_fiscal.periodo;
  IF p IS NOT NULL THEN RETURN p; END IF;
  SELECT dia INTO d FROM calendario_fiscal WHERE firma_id = fid AND formato = f;
  d := COALESCE(d, CASE f WHEN 'IT-1' THEN 20 WHEN 'IR-17' THEN 10 WHEN 'IR-2' THEN 120 ELSE 15 END);
  IF f = 'IR-2' THEN
    RETURN (inicio + interval '1 month' - interval '1 day')::date + d;
  END IF;
  RETURN LEAST((inicio + interval '1 month')::date + (d - 1), (inicio + interval '2 month' - interval '1 day')::date);
END $$;
GRANT EXECUTE ON FUNCTION vencimiento_fiscal(text, text) TO contable_app;

-- Responsable de revisar las normas nuevas de la DGII y registro de cada revisión (con el documento de la DGII adjunto).
ALTER TABLE firmas ADD COLUMN responsable_normas_id uuid REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE TABLE revisiones_normas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  revisado text NOT NULL CHECK (length(btrim(revisado)) BETWEEN 3 AND 1000),
  hubo_cambios boolean NOT NULL DEFAULT false,
  archivo_nombre text,
  archivo_tipo text CHECK (archivo_tipo IS NULL OR archivo_tipo IN ('application/pdf', 'image/jpeg', 'image/png')),
  archivo bytea CHECK (archivo IS NULL OR octet_length(archivo) <= 4194304),
  por uuid REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX revisiones_normas_firma ON revisiones_normas (firma_id, fecha DESC);
-- Un registro de revisión no se cambia: si hubo un error se registra otra revisión.
CREATE FUNCTION revisiones_normas_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Una revisión registrada no se cambia' USING ERRCODE = 'check_violation'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER revisiones_normas_proteger BEFORE UPDATE ON revisiones_normas FOR EACH ROW EXECUTE FUNCTION revisiones_normas_proteger();
UPDATE firmas f SET responsable_normas_id = (
  SELECT mf.usuario_id FROM miembros_firma mf JOIN usuarios u ON u.id = mf.usuario_id
   WHERE mf.firma_id = f.id AND mf.administrador ORDER BY (u.email IN ('patriciapm2312@gmail.com', 'empiretaxnlegal@gmail.com')) DESC, u.creado LIMIT 1);

-- Historial de lo que se cambia en Normas y tasas (calendario, prórrogas, responsable, tasas cargadas a los clientes y revisiones).
-- Los cambios de cada tasa quedan además en el historial de cada cliente (tablas impuestos y retenciones, auditadas).
CREATE TABLE historial_normas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  fecha timestamptz NOT NULL DEFAULT now(),
  por uuid REFERENCES usuarios(id),
  que text NOT NULL
);
CREATE INDEX historial_normas_firma ON historial_normas (firma_id, fecha DESC);
