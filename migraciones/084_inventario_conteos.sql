-- Prioridad 3 · P3l · Inventario: conteos (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas). Como a los clientes no se les lleva contabilidad, lo que «debería haber»
-- viene del Excel de existencias que da el cliente: se sube al abrir el conteo y queda guardado tal cual estaba ese día (`conteo_articulos`). Lo contado se anota con un lector de
-- código de barras que funciona como teclado, o a mano, y cada lectura queda guardada (`conteo_lecturas`; las que se deshacen quedan marcadas, no se borran). Un conteo cerrado no
-- cambia. El reporte de diferencias en cantidad y pesos es la entrega P3m. El Excel original se guarda en `documentos` (entidad 'conteo').

ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion', 'expediente', 'tramite', 'formulario', 'factura_subida', 'pago_impuesto', 'auditoria', 'conteo'));

CREATE TABLE conteos_inventario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero int NOT NULL,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 3 AND 150),
  ubicacion text NOT NULL DEFAULT '' CHECK (length(ubicacion) <= 150),      -- bodega, tienda, sucursal…
  fecha date NOT NULL,                                                       -- el día del conteo (y de las existencias del listado)
  notas text NOT NULL DEFAULT '' CHECK (length(notas) <= 2000),
  archivo_nombre text NOT NULL DEFAULT '' CHECK (length(archivo_nombre) <= 200),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  cerrado_por uuid REFERENCES usuarios(id),
  cerrado_en timestamptz,
  UNIQUE (empresa_id, numero)
);

CREATE TABLE conteo_articulos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  conteo_id uuid NOT NULL REFERENCES conteos_inventario(id) ON DELETE CASCADE,
  orden int NOT NULL,
  codigo text NOT NULL CHECK (length(btrim(codigo)) BETWEEN 1 AND 60),
  codigo_norm text NOT NULL,                       -- para comparar: sin espacios, en mayúsculas y sin ceros a la izquierda
  barras text NOT NULL DEFAULT '' CHECK (length(barras) <= 60),
  barras_norm text NOT NULL DEFAULT '',
  nombre text NOT NULL DEFAULT '' CHECK (length(nombre) <= 200),
  unidad text NOT NULL DEFAULT '' CHECK (length(unidad) <= 30),
  existencia numeric(18,4) NOT NULL CHECK (existencia >= 0),   -- lo que dice el sistema del cliente
  costo numeric(18,4) CHECK (costo >= 0),                      -- costo por unidad, si el Excel lo trae
  UNIQUE (conteo_id, codigo_norm)
);
CREATE INDEX conteo_articulos_barras_idx ON conteo_articulos(conteo_id, barras_norm) WHERE barras_norm <> '';

CREATE TABLE conteo_lecturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  conteo_id uuid NOT NULL REFERENCES conteos_inventario(id) ON DELETE CASCADE,
  articulo_id uuid REFERENCES conteo_articulos(id) ON DELETE CASCADE,   -- vacío: el código no está en el listado
  codigo_leido text NOT NULL CHECK (length(btrim(codigo_leido)) BETWEEN 1 AND 60),
  codigo_norm text NOT NULL,
  cantidad numeric(18,4) NOT NULL CHECK (cantidad <> 0),
  origen text NOT NULL CHECK (origen IN ('lector', 'manual', 'ajuste')),   -- ajuste: se fijó el total contado de un artículo (puede ser negativo)
  nota text NOT NULL DEFAULT '' CHECK (length(nota) <= 300),
  anulada boolean NOT NULL DEFAULT false,
  anulada_por uuid REFERENCES usuarios(id),
  anulada_en timestamptz,
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK (origen = 'ajuste' OR cantidad > 0)
);
CREATE INDEX conteo_lecturas_idx ON conteo_lecturas(conteo_id, creado_en DESC);
CREATE INDEX conteo_lecturas_articulo_idx ON conteo_lecturas(articulo_id) WHERE articulo_id IS NOT NULL;

-- Un conteo cerrado no cambia: ni su listado ni sus lecturas ni él mismo (reabrirlo es devolverlo a «abierto»).
CREATE FUNCTION conteo_cerrado_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; cerrado boolean;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- borrado en cascada al quitar la empresa o el conteo
  cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.conteo_id ELSE NEW.conteo_id END;
  SELECT estado = 'cerrado' INTO cerrado FROM conteos_inventario WHERE id = cid;
  IF cerrado THEN RAISE EXCEPTION 'El conteo está cerrado: reábrelo para cambiar el listado o las lecturas.' USING ERRCODE = 'P0001'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER conteo_articulos_cerrado BEFORE INSERT OR UPDATE OR DELETE ON conteo_articulos FOR EACH ROW EXECUTE FUNCTION conteo_cerrado_proteger();
CREATE TRIGGER conteo_lecturas_cerrado BEFORE INSERT OR UPDATE OR DELETE ON conteo_lecturas FOR EACH ROW EXECUTE FUNCTION conteo_cerrado_proteger();

CREATE FUNCTION conteos_proteger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'cerrado' AND NEW.estado = 'cerrado' THEN
    RAISE EXCEPTION 'El conteo está cerrado: reábrelo para cambiarlo.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conteos_cerrado BEFORE UPDATE ON conteos_inventario FOR EACH ROW EXECUTE FUNCTION conteos_proteger();

ALTER TABLE conteos_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteos_inventario FORCE ROW LEVEL SECURITY;
CREATE POLICY conteos_inventario_empresa ON conteos_inventario USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON conteos_inventario TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON conteos_inventario FOR EACH ROW EXECUTE FUNCTION auditar();

-- El listado y las lecturas son muchas filas (miles): no llevan historial de cambios; cada lectura guarda quién y cuándo, y las deshechas quedan marcadas.
ALTER TABLE conteo_articulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_articulos FORCE ROW LEVEL SECURITY;
CREATE POLICY conteo_articulos_empresa ON conteo_articulos USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, DELETE ON conteo_articulos TO contable_app;

ALTER TABLE conteo_lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_lecturas FORCE ROW LEVEL SECURITY;
CREATE POLICY conteo_lecturas_empresa ON conteo_lecturas USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON conteo_lecturas TO contable_app;
