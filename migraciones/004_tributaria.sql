-- Fase 2: configuración tributaria por empresa. Perfil fiscal, impuestos y tasas con vigencia, retenciones,
-- todos los tipos de comprobante (NCF y e-CF) y obligaciones. Nada fijo en el código: cada empresa configura lo suyo.

-- ───────────── Perfil fiscal de la empresa ─────────────

ALTER TABLE empresas
  ADD COLUMN tipo_persona text NOT NULL DEFAULT 'juridica' CHECK (tipo_persona IN ('juridica', 'fisica')),
  ADD COLUMN contribuye_itbis boolean NOT NULL DEFAULT true,
  ADD COLUMN agente_retencion boolean NOT NULL DEFAULT true,
  ADD COLUMN emisor_ecf boolean NOT NULL DEFAULT false,
  ADD COLUMN ecf_desde date,
  ADD CONSTRAINT empresas_ecf_check CHECK (emisor_ecf OR ecf_desde IS NULL);

UPDATE empresas SET tipo_persona = 'fisica', agente_retencion = false WHERE tipo_identificacion = 'cedula';

-- ───────────── Impuestos (ITBIS por tasa, exento, selectivo, propina legal, otros) ─────────────

CREATE TABLE impuestos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo text NOT NULL CHECK (tipo IN ('itbis', 'exento', 'isc', 'propina', 'otro')),
  tasa numeric(7,4) NOT NULL CHECK (tasa >= 0 AND tasa <= 100),
  -- Ventas: el impuesto cobrado (pasivo). Compras: el pagado que da crédito (activo).
  cuenta_ventas_id uuid REFERENCES cuentas(id),
  cuenta_compras_id uuid REFERENCES cuentas(id),
  vigente_desde date NOT NULL DEFAULT '2000-01-01',
  vigente_hasta date,
  activo boolean NOT NULL DEFAULT true,
  nota text,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre, vigente_desde),
  CHECK (tipo <> 'exento' OR tasa = 0),
  CHECK (tasa = 0 OR (cuenta_ventas_id IS NOT NULL AND cuenta_compras_id IS NOT NULL)),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

-- ───────────── Retenciones (ITBIS: % del ITBIS facturado; ISR: % del monto sin ITBIS) ─────────────

CREATE TABLE retenciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
  impuesto text NOT NULL CHECK (impuesto IN ('itbis', 'isr')),
  tasa numeric(7,4) NOT NULL CHECK (tasa > 0 AND tasa <= 100),
  -- Cuando un cliente nos retiene (activo) y cuando retenemos a un proveedor (pasivo hasta pagarlo a la DGII).
  cuenta_por_terceros_id uuid NOT NULL REFERENCES cuentas(id),
  cuenta_a_terceros_id uuid NOT NULL REFERENCES cuentas(id),
  -- Tipo de retención de ISR del formato 606 (1 a 8).
  codigo_606 smallint CHECK (codigo_606 BETWEEN 1 AND 8),
  vigente_desde date NOT NULL DEFAULT '2000-01-01',
  vigente_hasta date,
  activo boolean NOT NULL DEFAULT true,
  nota text,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre, vigente_desde),
  CHECK (impuesto = 'isr' OR codigo_606 IS NULL),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

-- Las cuentas asignadas deben ser cuentas de detalle activas de la misma empresa.
CREATE FUNCTION validar_cuentas_fiscales() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c text; cid uuid;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    cid := (to_jsonb(NEW)->>c)::uuid;
    CONTINUE WHEN cid IS NULL;
    IF NOT EXISTS (SELECT 1 FROM cuentas WHERE id = cid AND empresa_id = NEW.empresa_id AND de_detalle AND activa) THEN
      RAISE EXCEPTION 'La cuenta asignada debe ser una cuenta de detalle activa de esta empresa' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER impuestos_cuentas BEFORE INSERT OR UPDATE ON impuestos
  FOR EACH ROW EXECUTE FUNCTION validar_cuentas_fiscales('cuenta_ventas_id', 'cuenta_compras_id');
CREATE TRIGGER retenciones_cuentas BEFORE INSERT OR UPDATE ON retenciones
  FOR EACH ROW EXECUTE FUNCTION validar_cuentas_fiscales('cuenta_por_terceros_id', 'cuenta_a_terceros_id');

-- ───────────── Obligaciones que la empresa declara (el catálogo está en lib/fiscal.ts) ─────────────

CREATE TABLE obligaciones_empresa (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  clave text NOT NULL CHECK (clave ~ '^[a-z0-9_]+$'),
  activa boolean NOT NULL,
  PRIMARY KEY (empresa_id, clave)
);

-- ───────────── Comprobantes: todos los tipos de NCF y de e-CF ─────────────
-- NCF: B + 2 dígitos + 8 de secuencia. e-NCF: E + 2 dígitos + 10 de secuencia.

ALTER TABLE secuencias_ncf DROP CONSTRAINT secuencias_ncf_tipo_check;
ALTER TABLE secuencias_ncf DROP CONSTRAINT secuencias_ncf_hasta_check;
ALTER TABLE secuencias_ncf
  ADD CONSTRAINT secuencias_ncf_tipo_check CHECK (tipo IN ('B01', 'B02', 'B03', 'B04', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17',
                                                          'E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47')),
  ADD CONSTRAINT secuencias_ncf_hasta_check CHECK (hasta <= CASE WHEN tipo LIKE 'E%' THEN 9999999999 ELSE 99999999 END);

-- ───────────── Aislamiento, permisos y auditoría ─────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['impuestos', 'retenciones', 'obligaciones_empresa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())',
                   t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;
GRANT DELETE ON obligaciones_empresa TO contable_app;

-- Nuevo permiso «impuestos» para configurar lo tributario; lo reciben los perfiles base Administrador y Contador.
CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true),
    (fid, 'Solo lectura', ARRAY['ver','exportar'], true)
  ON CONFLICT (firma_id, nombre) DO NOTHING;
$$;
UPDATE perfiles SET permisos = array_append(permisos, 'impuestos')
 WHERE sistema AND nombre IN ('Administrador', 'Contador') AND NOT ('impuestos' = ANY (permisos));

-- ───────────── Configuración inicial sugerida ─────────────
-- Valores de partida tomados de la normativa vigente al 22-oct-2026. Cada firma los revisa y ajusta por cliente.

CREATE FUNCTION configurar_tributaria(eid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.empresa_id', eid::text, true);

  INSERT INTO impuestos (empresa_id, nombre, tipo, tasa, cuenta_ventas_id, cuenta_compras_id, vigente_desde, nota)
  SELECT eid, i.nombre, i.tipo, i.tasa,
         CASE WHEN i.tasa > 0 THEN v.id END, CASE WHEN i.tasa > 0 THEN c.id END, '2000-01-01', i.nota
    FROM (VALUES
      ('ITBIS 18 %', 'itbis', 18, 'Tasa general (Código Tributario, art. 341).'),
      ('ITBIS 16 %', 'itbis', 16, 'Tasa reducida para los bienes que indica la Ley 253-12.'),
      ('Exento', 'exento', 0, 'Bienes y servicios exentos (Código Tributario, arts. 343 y 344).')
    ) AS i(nombre, tipo, tasa, nota)
    LEFT JOIN cuentas v ON v.empresa_id = eid AND v.codigo = '210201' AND v.de_detalle AND v.activa
    LEFT JOIN cuentas c ON c.empresa_id = eid AND c.codigo = '110401' AND c.de_detalle AND c.activa
   WHERE i.tasa = 0 OR (v.id IS NOT NULL AND c.id IS NOT NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO retenciones (empresa_id, nombre, impuesto, tasa, cuenta_por_terceros_id, cuenta_a_terceros_id, codigo_606,
                           vigente_desde, vigente_hasta, nota)
  SELECT eid, r.nombre, r.impuesto, r.tasa, pt.id, at.id, r.codigo, r.desde::date, r.hasta::date, r.nota
    FROM (VALUES
      ('ITBIS retenido 30 %', 'itbis', 30, NULL, '2000-01-01', NULL, '110404', '210202',
       'Norma General 02-05 y sus modificaciones. Desde el 16-sep-2026 no aplica cuando el proveedor es persona jurídica, emisor electrónico y factura con e-CF (Norma General 02-2026).'),
      ('ITBIS retenido 100 %', 'itbis', 100, NULL, '2000-01-01', NULL, '110404', '210202',
       'Norma General 02-05 y sus modificaciones (por ejemplo, servicios de personas físicas).'),
      ('ISR honorarios a personas físicas 10 %', 'isr', 10, 2, '2000-01-01', '2026-06-30', '110403', '210203',
       'Código Tributario, art. 309. Sustituida por el 15 % desde el 1-jul-2026.'),
      ('ISR honorarios a personas físicas 15 %', 'isr', 15, 2, '2026-07-01', NULL, '110403', '210203',
       'Ley 30-26, desde el 1-jul-2026.'),
      ('ISR proveedores del Estado 5 %', 'isr', 5, 7, '2000-01-01', NULL, '110403', '210203',
       'Retención que hacen las entidades del Estado a sus proveedores.')
    ) AS r(nombre, impuesto, tasa, codigo, desde, hasta, cod_terceros, cod_a_terceros, nota)
    JOIN cuentas pt ON pt.empresa_id = eid AND pt.codigo = r.cod_terceros AND pt.de_detalle AND pt.activa
    JOIN cuentas at ON at.empresa_id = eid AND at.codigo = r.cod_a_terceros AND at.de_detalle AND at.activa
  ON CONFLICT DO NOTHING;
END $$;

DO $$
DECLARE e record;
BEGIN
  FOR e IN SELECT id FROM empresas LOOP
    PERFORM configurar_tributaria(e.id);
  END LOOP;
  PERFORM set_config('app.empresa_id', '', true);
END $$;
