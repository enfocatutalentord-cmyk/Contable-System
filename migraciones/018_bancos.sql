-- Fase 5, parte 1 (30-oct-2026, «sí» de Joannie a la estructura): cuentas bancarias e importación de estados de cuenta.
-- Como Xero y QuickBooks Online cuando no hay conexión con el banco: se sube el archivo que da el banco (Excel, CSV u OFX),
-- se indica una vez qué columna es cada dato (queda guardado para esa cuenta), se ve una vista previa y se importa sin
-- repetir movimientos aunque el archivo se monte sobre uno anterior. La conciliación (parte 2) se hace contra las líneas
-- de asiento de la cuenta contable del banco, que es donde caen cobros, pagos y asientos manuales.

CREATE TABLE cuentas_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_id uuid NOT NULL REFERENCES cuentas(id),          -- cuenta del catálogo (110103, 110104…)
  banco text NOT NULL,
  nombre text NOT NULL,                                      -- cómo se le llama («Popular corriente»)
  numero text CHECK (numero ~ '^\d{4}$'),                    -- solo los últimos 4 dígitos
  moneda text NOT NULL DEFAULT 'DOP' CHECK (moneda IN ('DOP', 'USD')),
  saldo_inicial numeric(18,2) NOT NULL DEFAULT 0,            -- saldo según el banco al empezar a conciliar
  fecha_inicial date NOT NULL,
  formato jsonb,                                             -- qué columna es cada dato en el archivo de este banco
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, cuenta_id)
);
CREATE TRIGGER cuentas_bancarias_referencias BEFORE INSERT OR UPDATE ON cuentas_bancarias FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas.cuenta_id');

-- La cuenta del banco tiene que ser una cuenta de activo de detalle y activa.
CREATE FUNCTION cuenta_bancaria_valida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cuentas WHERE id = NEW.cuenta_id AND tipo = 'activo' AND de_detalle AND activa) THEN
    RAISE EXCEPTION 'La cuenta del banco debe ser una cuenta de activo de detalle y activa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cuentas_bancarias_valida BEFORE INSERT OR UPDATE OF cuenta_id ON cuentas_bancarias FOR EACH ROW
  EXECUTE FUNCTION cuenta_bancaria_valida();

-- Cada archivo subido. Queda guardado como soporte; en borrador se revisa la vista previa y se ajusta el formato.
CREATE TABLE importaciones_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id uuid NOT NULL REFERENCES cuentas_bancarias(id),
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'importada', 'deshecha', 'descartada')),
  nombre text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('csv', 'xlsx', 'ofx')),
  tamano int NOT NULL CHECK (tamano > 0 AND tamano <= 4194304),
  sha256 text NOT NULL,
  contenido bytea NOT NULL,
  formato jsonb,
  recepcion_id uuid REFERENCES recepciones(id),
  desde date, hasta date,
  nuevos int, repetidos int,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado timestamptz NOT NULL DEFAULT now(),
  importado_por uuid REFERENCES usuarios(id),
  importado_en timestamptz,
  deshecho_por uuid REFERENCES usuarios(id),
  deshecho_en timestamptz
);
CREATE INDEX importaciones_banco_cuenta_idx ON importaciones_banco(cuenta_bancaria_id, creado DESC);
CREATE UNIQUE INDEX importaciones_banco_sin_repetir ON importaciones_banco(cuenta_bancaria_id, sha256) WHERE estado = 'importada';
CREATE TRIGGER importaciones_banco_referencias BEFORE INSERT OR UPDATE ON importaciones_banco FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas_bancarias.cuenta_bancaria_id', 'recepciones.recepcion_id');

-- Movimientos del estado de cuenta. monto > 0 entra al banco (depósito, crédito); < 0 sale (retiro, cheque, cargo).
-- «huella» = fecha, monto, descripción y referencia normalizados; «ocurrencia» numera los movimientos idénticos del
-- mismo archivo (dos cargos iguales el mismo día). Así un archivo que se monta sobre otro no repite nada.
CREATE TABLE movimientos_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id uuid NOT NULL REFERENCES cuentas_bancarias(id),
  importacion_id uuid NOT NULL REFERENCES importaciones_banco(id),
  fecha date NOT NULL,
  descripcion text NOT NULL,
  referencia text,
  monto numeric(18,2) NOT NULL CHECK (monto <> 0),
  saldo numeric(18,2),                                       -- balance que muestra el banco después del movimiento
  huella text NOT NULL,
  ocurrencia smallint NOT NULL DEFAULT 1,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conciliado', 'excluido')),
  orden int NOT NULL,                                        -- posición en el archivo
  UNIQUE (cuenta_bancaria_id, huella, ocurrencia)
);
CREATE INDEX movimientos_banco_cuenta_idx ON movimientos_banco(cuenta_bancaria_id, fecha, orden);
CREATE INDEX movimientos_banco_estado_idx ON movimientos_banco(empresa_id, estado);

-- Nada del banco entra ni se deshace en un período cerrado.
CREATE FUNCTION movimientos_banco_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bloqueo date;
BEGIN
  SELECT fecha_bloqueo INTO bloqueo FROM empresas WHERE id = COALESCE(NEW.empresa_id, OLD.empresa_id);
  IF bloqueo IS NOT NULL AND COALESCE(NEW.fecha, OLD.fecha) <= bloqueo THEN
    RAISE EXCEPTION 'El período está cerrado hasta el %: no se pueden importar ni quitar movimientos de esa fecha', to_char(bloqueo, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'conciliado' THEN
      RAISE EXCEPTION 'El movimiento ya está conciliado' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movimientos_banco_periodo BEFORE INSERT OR DELETE ON movimientos_banco FOR EACH ROW
  EXECUTE FUNCTION movimientos_banco_periodo();
CREATE TRIGGER movimientos_banco_referencias BEFORE INSERT ON movimientos_banco FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('cuentas_bancarias.cuenta_bancaria_id', 'importaciones_banco.importacion_id');

ALTER TABLE cuentas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_bancarias FORCE ROW LEVEL SECURITY;
CREATE POLICY cuentas_bancarias_empresa ON cuentas_bancarias USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE importaciones_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE importaciones_banco FORCE ROW LEVEL SECURITY;
CREATE POLICY importaciones_banco_empresa ON importaciones_banco USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
ALTER TABLE movimientos_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_banco FORCE ROW LEVEL SECURITY;
CREATE POLICY movimientos_banco_empresa ON movimientos_banco USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());

GRANT SELECT, INSERT ON cuentas_bancarias TO contable_app;
GRANT UPDATE (banco, nombre, numero, saldo_inicial, fecha_inicial, formato, activa) ON cuentas_bancarias TO contable_app;
GRANT SELECT, INSERT ON importaciones_banco TO contable_app;
GRANT UPDATE (estado, formato, desde, hasta, nuevos, repetidos, importado_por, importado_en, deshecho_por, deshecho_en) ON importaciones_banco TO contable_app;
GRANT SELECT, INSERT, DELETE ON movimientos_banco TO contable_app;
GRANT UPDATE (estado) ON movimientos_banco TO contable_app;

CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON cuentas_bancarias FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON importaciones_banco FOR EACH ROW EXECUTE FUNCTION auditar();

-- Los estados de cuenta que sube el cliente en «Mis documentos» también pueden venir en Excel, CSV u OFX, para importarlos.
ALTER TABLE recepciones DROP CONSTRAINT recepciones_tipo_check;
ALTER TABLE recepciones ADD CONSTRAINT recepciones_tipo_check CHECK (
  tipo IN ('application/pdf', 'image/jpeg', 'image/png')
  OR (categoria = 'estado_bancario' AND tipo IN ('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/x-ofx')));

-- Pestaña nueva «Bancos» (/bancos): la ven el Contador (concilia) y el Auxiliar (importa y prepara); Administrador y
-- Solo lectura ya ven todo.
UPDATE perfiles SET pestanas = array_append(pestanas, '/bancos')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar') AND pestanas IS NOT NULL AND NOT ('/bancos' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/dgii', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor', '/balanza']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
