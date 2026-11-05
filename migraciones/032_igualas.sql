-- Bloque 2, entrega 2b (Sistema Empire, «sí» de Patricia del 4-nov-2026): igualas y facturas recurrentes. Respuestas de ese
-- día: las igualas se preparan como borradores y se emiten con un clic (como el borrador de Xero y el recordatorio de
-- QuickBooks); el comprobante es el habitual de cada cliente.

-- ───── Acuerdo de cada cliente (Hoja de Acuerdo EMP-F02) ─────
-- normal: iguala mensual. arranque: Plan de Arranque (mes gratis = tarifa 0, o tarifa especial) hasta una fecha. ajuste: ajuste
-- gradual (tarifa actual hasta la fecha de la nueva iguala). especial: acuerdo especial con deuda, cuota y fecha de término.
-- cero: declaración en cero (RD$600 a RD$2,500).
CREATE TABLE acuerdos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('normal', 'arranque', 'ajuste', 'especial', 'cero')),
  servicio_id uuid NOT NULL REFERENCES servicios(id),
  monto numeric(18,2) NOT NULL CHECK (monto >= 0),
  tarifa_especial numeric(18,2) CHECK (tarifa_especial >= 0),
  tarifa_hasta date,
  deuda numeric(18,2) CHECK (deuda > 0),
  cuota numeric(18,2) CHECK (cuota > 0),
  deuda_hasta date,
  inicio date NOT NULL,
  dia_facturacion int NOT NULL DEFAULT 30 CHECK (dia_facturacion BETWEEN 1 AND 31),
  servicios_incluidos text[] NOT NULL DEFAULT '{}',
  notas text,
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK ((tarifa_especial IS NULL) = (tarifa_hasta IS NULL)),
  CHECK ((cuota IS NULL) = (deuda_hasta IS NULL)),
  CHECK (tipo <> 'cero' OR monto BETWEEN 600 AND 2500)
);
CREATE UNIQUE INDEX acuerdos_cliente_activo_idx ON acuerdos_cliente(empresa_id, cliente_id) WHERE activo;

-- Aumento anual de 10 % (aniversario del inicio): queda propuesto y aplica solo cuando se confirma.
CREATE TABLE aumentos_iguala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  acuerdo_id uuid NOT NULL REFERENCES acuerdos_cliente(id) ON DELETE CASCADE,
  aniversario date NOT NULL,
  monto_anterior numeric(18,2) NOT NULL,
  monto_nuevo numeric(18,2) NOT NULL,
  confirmado_por uuid NOT NULL REFERENCES usuarios(id),
  confirmado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (acuerdo_id, aniversario)
);

-- ───── Facturas recurrentes (Anexo A del manual: a terceros por cuenta del cliente) ─────
-- Plantilla con sus líneas; cada vez que toca se prepara un borrador.
CREATE TABLE facturas_recurrentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 120),
  frecuencia text NOT NULL CHECK (frecuencia IN ('mensual', 'quincenal', 'trimestral', 'anual', 'a_solicitud')),
  proxima date,
  hasta date,
  tipo_ncf text CHECK (tipo_ncf IN ('B01', 'B02', 'B14', 'B15', 'B16')),
  lineas jsonb NOT NULL CHECK (jsonb_typeof(lineas) = 'array' AND jsonb_array_length(lineas) > 0),
  notas text,
  activa boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now(),
  CHECK (frecuencia = 'a_solicitud' OR proxima IS NOT NULL)
);

-- Cada borrador sabe de qué iguala o plantilla salió y de qué período (AAAAMM o fecha): no se repite.
ALTER TABLE facturas
  ADD COLUMN acuerdo_id uuid REFERENCES acuerdos_cliente(id) ON DELETE SET NULL,
  ADD COLUMN recurrente_id uuid REFERENCES facturas_recurrentes(id) ON DELETE SET NULL,
  ADD COLUMN periodo text;
CREATE UNIQUE INDEX facturas_acuerdo_periodo_idx ON facturas(acuerdo_id, periodo) WHERE acuerdo_id IS NOT NULL AND NOT anulada;
CREATE UNIQUE INDEX facturas_recurrente_periodo_idx ON facturas(recurrente_id, periodo) WHERE recurrente_id IS NOT NULL AND NOT anulada;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['acuerdos_cliente', 'aumentos_iguala', 'facturas_recurrentes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual())', t || '_empresa', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO contable_app', t);
    EXECUTE format('CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION auditar()', t);
  END LOOP;
END $$;

-- El cliente y el servicio del acuerdo o la plantilla son de la misma empresa.
CREATE FUNCTION acuerdo_referencias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = NEW.cliente_id AND empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El cliente no es de esta empresa' USING ERRCODE = 'P0001';
  END IF;
  -- plpgsql no corta la condición: el servicio se mira aparte, solo en los acuerdos (las plantillas no tienen).
  IF TG_TABLE_NAME = 'acuerdos_cliente' THEN
    IF NOT EXISTS (SELECT 1 FROM servicios WHERE id = NEW.servicio_id AND empresa_id = NEW.empresa_id) THEN
      RAISE EXCEPTION 'El servicio no es de esta empresa' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER acuerdos_referencias BEFORE INSERT OR UPDATE ON acuerdos_cliente FOR EACH ROW EXECUTE FUNCTION acuerdo_referencias();
CREATE TRIGGER recurrentes_referencias BEFORE INSERT OR UPDATE ON facturas_recurrentes FOR EACH ROW EXECUTE FUNCTION acuerdo_referencias();

-- ───── Pestañas «Igualas» y «Facturas recurrentes» en los roles base ─────
UPDATE perfiles SET pestanas = pestanas || ARRAY['/igualas', '/recurrentes']
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Facturación') AND pestanas IS NOT NULL AND NOT ('/igualas' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/igualas', '/recurrentes', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/igualas', '/recurrentes', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor', '/balanza', '/estados', '/reportes']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/igualas', '/recurrentes', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
