-- Roles con pestañas visibles (29-oct-2026, pedido de Joannie: que cada rol vea solo las pestañas que ella elija, y que
-- haya roles para los clientes). Como los roles personalizados de QuickBooks Online y de Alegra, que limitan los módulos.
--   pestanas: rutas de las pestañas que ve el rol (lib/pestanas.ts); NULL = todas.
--   para_clientes: el rol es para usuarios de las empresas cliente (entran directo a su empresa, sin las pantallas de la firma).
ALTER TABLE perfiles ADD COLUMN pestanas text[];
ALTER TABLE perfiles ADD COLUMN para_clientes boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true),
    (fid, 'Solo lectura', ARRAY['ver','exportar'], true)
  ON CONFLICT (firma_id, nombre) DO NOTHING;
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/compras'])
  ON CONFLICT (firma_id, nombre) DO NOTHING;
$$;

SELECT crear_perfiles_firma(id) FROM firmas;
