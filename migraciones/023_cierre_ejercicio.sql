-- Fase 7, parte 3 (31-oct-2026): cierre del ejercicio y Centro de reportes.

-- Cierre del ejercicio: el sistema propone el asiento que lleva ingresos, costos y gastos a «Resultado del ejercicio» y, aparte,
-- el traspaso a «Resultados acumulados». Se guarda qué asientos se hicieron y el bloqueo que había, para poder deshacerlo.
CREATE TABLE cierres_ejercicio (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fin date NOT NULL,                                  -- último día del ejercicio
  asiento_id uuid NOT NULL REFERENCES asientos(id),
  traspaso_id uuid REFERENCES asientos(id),
  resultado numeric(18,2) NOT NULL,                   -- utilidad (+) o pérdida (−) del ejercicio
  bloqueo_anterior date,
  cerrado_por uuid NOT NULL REFERENCES usuarios(id),
  cerrado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, fin)
);
ALTER TABLE cierres_ejercicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_ejercicio FORCE ROW LEVEL SECURITY;
CREATE POLICY cierres_ejercicio_empresa ON cierres_ejercicio USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, DELETE ON cierres_ejercicio TO contable_app;
GRANT UPDATE (traspaso_id) ON cierres_ejercicio TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON cierres_ejercicio FOR EACH ROW EXECUTE FUNCTION auditar();

-- Centro de reportes (/reportes): una sola pantalla con los reportes que cada rol puede ver. La ven todos los roles con
-- reportes (cada uno ve solo los de sus pestañas).
UPDATE perfiles SET pestanas = array_append(pestanas, '/reportes')
 WHERE sistema AND nombre IN ('Contador', 'Auxiliar', 'Facturación', 'Cliente · Consulta')
   AND pestanas IS NOT NULL AND NOT ('/reportes' = ANY (pestanas));

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor', '/balanza', '/estados', '/reportes']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;
