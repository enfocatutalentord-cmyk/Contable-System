-- Fase 6, parte 1 (29-oct-2026, «sí» de Joannie): formatos de envío de datos 606, 607 y 608 de la DGII
-- (Norma General 07-2018; instructivos de la DGII de febrero 2026 (606), diciembre 2025 (607) y marzo 2026 (608)).

-- 607, campo 5 «Tipo de Ingreso»: 01 operaciones (no financieros), 02 financieros, 03 extraordinarios,
-- 04 arrendamientos, 05 venta de activo depreciable, 06 otros. Lo emitido antes queda como 01.
ALTER TABLE facturas ADD COLUMN tipo_ingreso text NOT NULL DEFAULT '01' CHECK (tipo_ingreso ~ '^0[1-6]$');
ALTER TABLE clientes ADD COLUMN tipo_ingreso text NOT NULL DEFAULT '01' CHECK (tipo_ingreso ~ '^0[1-6]$');

-- 606, campo 17: el instructivo de febrero 2026 agrega el código 9 «Retenciones subsector ganadería de carne bovina».
ALTER TABLE retenciones DROP CONSTRAINT retenciones_codigo_606_check;
ALTER TABLE retenciones ADD CONSTRAINT retenciones_codigo_606_check CHECK (codigo_606 BETWEEN 1 AND 9);

-- Constancia de cada envío: quién lo marcó como enviado, cuándo, la referencia de la Oficina Virtual y una huella de lo
-- enviado (cantidad de registros y totales) para avisar si después cambia algo de ese mes.
CREATE TABLE envios_dgii (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  formato text NOT NULL CHECK (formato IN ('606', '607', '608')),
  periodo text NOT NULL CHECK (periodo ~ '^\d{4}(0[1-9]|1[0-2])$'),   -- AAAAMM, como lo pide la DGII
  en_cero boolean NOT NULL DEFAULT false,                              -- «Declaraciones en cero» (sin operaciones)
  referencia text,
  huella text NOT NULL,
  registros int NOT NULL,
  enviado_por uuid NOT NULL REFERENCES usuarios(id),
  enviado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, formato, periodo)
);
ALTER TABLE envios_dgii ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_dgii FORCE ROW LEVEL SECURITY;
CREATE POLICY envios_dgii_empresa ON envios_dgii USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, DELETE ON envios_dgii TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON envios_dgii FOR EACH ROW EXECUTE FUNCTION auditar();

-- Pestaña nueva «Reportes DGII» (/dgii): la ven el Contador (prepara y marca el envío) y quien ya ve todo.
UPDATE perfiles SET pestanas = array_append(pestanas, '/dgii')
 WHERE sistema AND nombre = 'Contador' AND pestanas IS NOT NULL AND NOT ('/dgii' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/dgii', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/diario', '/mayor', '/balanza']),
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

-- 608: también se reportan anulados los comprobantes que emitimos nosotros en compras (B11, B13, B17). Al anular una
-- compra con comprobante propio se elige el «Tipo de Anulación» del instructivo (01 a 10).
ALTER TABLE compras ADD COLUMN motivo_608 text CHECK (motivo_608 ~ '^(0[1-9]|10)$');
CREATE OR REPLACE FUNCTION compras_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado <> 'borrador' AND EXISTS (SELECT 1 FROM empresas WHERE id = OLD.empresa_id) THEN
      RAISE EXCEPTION 'Una compra registrada no se borra; se anula' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'registrada' AND (to_jsonb(NEW) - ARRAY['anulada', 'motivo_anulacion', 'motivo_608', 'anulada_por', 'anulada_en'])
                                 <> (to_jsonb(OLD) - ARRAY['anulada', 'motivo_anulacion', 'motivo_608', 'anulada_por', 'anulada_en']) THEN
    RAISE EXCEPTION 'Una compra registrada no se modifica; se anula o se corrige con la nota de crédito del proveedor' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.anulada AND NOT NEW.anulada THEN
    RAISE EXCEPTION 'Una compra anulada no se puede reactivar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
