-- Bloque 2, entrega 2a (Sistema Empire, «sí» de Patricia del 4-nov-2026): Lista de Precios (EMP-P01). Cada servicio tiene su
-- grupo, su código y su unidad de negocio, y un precio por categoría de cliente con fecha de vigencia (un cambio de precio no
-- toca lo ya facturado). El precio de `servicios.precio` queda como precio general (sin categoría).

ALTER TABLE servicios
  ADD COLUMN grupo text CHECK (grupo IN ('contabilidad', 'control_interno', 'auditoria', 'laboral_tss', 'tributario', 'otros')),
  ADD COLUMN codigo text CHECK (length(btrim(codigo)) BETWEEN 1 AND 20),
  ADD COLUMN unidad_id uuid REFERENCES unidades_negocio(id);
CREATE UNIQUE INDEX servicios_codigo_idx ON servicios(empresa_id, codigo) WHERE codigo IS NOT NULL;

CREATE TABLE precios_servicio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  servicio_id uuid NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN ('pequena', 'mediana', 'grande', 'emprendedor')),
  precio numeric(18,2) NOT NULL CHECK (precio >= 0),
  vigente_desde date NOT NULL,
  creado timestamptz NOT NULL DEFAULT now(),
  UNIQUE (servicio_id, categoria, vigente_desde)
);
CREATE INDEX precios_servicio_idx ON precios_servicio(empresa_id, servicio_id, categoria, vigente_desde DESC);
ALTER TABLE precios_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_servicio FORCE ROW LEVEL SECURITY;
CREATE POLICY precios_servicio_empresa ON precios_servicio USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON precios_servicio TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON precios_servicio FOR EACH ROW EXECUTE FUNCTION auditar();

-- El precio y la unidad son del mismo servicio y de la misma empresa.
CREATE FUNCTION precio_servicio_empresa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM servicios WHERE id = NEW.servicio_id AND empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El servicio no es de esta empresa' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER precios_servicio_empresa BEFORE INSERT OR UPDATE ON precios_servicio FOR EACH ROW EXECUTE FUNCTION precio_servicio_empresa();
CREATE TRIGGER servicios_unidad BEFORE INSERT OR UPDATE OF unidad_id ON servicios FOR EACH ROW EXECUTE FUNCTION linea_unidad();

-- La categoría del cliente decide su precio. Para un cliente enlazado a una empresa de la firma sale de su ficha (y se pone al
-- día sola); para los demás se escribe en Clientes.
ALTER TABLE clientes ADD COLUMN categoria text CHECK (categoria IN ('pequena', 'mediana', 'grande', 'emprendedor'));

CREATE OR REPLACE FUNCTION sincronizar_cliente_de_firma(eid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  propia uuid;
  antes text := current_setting('app.empresa_id', true);
  cid uuid;
  tipo text;
BEGIN
  SELECT id, firma_id, nombre, rnc, tipo_identificacion, correo, telefono, direccion, categoria INTO e FROM empresas WHERE id = eid;
  IF e.id IS NULL OR e.firma_id IS NULL THEN RETURN; END IF;
  SELECT empresa_propia_id INTO propia FROM firmas WHERE id = e.firma_id;
  IF propia IS NULL OR propia = eid THEN RETURN; END IF;
  tipo := CASE WHEN e.rnc IS NULL THEN NULL WHEN length(e.rnc) = 9 THEN 'rnc' ELSE 'cedula' END;
  PERFORM set_config('app.empresa_id', propia::text, true);
  SELECT id INTO cid FROM clientes WHERE empresa_id = propia AND empresa_vinculada_id = eid;
  IF cid IS NULL AND e.rnc IS NOT NULL THEN
    SELECT id INTO cid FROM clientes WHERE empresa_id = propia AND rnc = e.rnc AND empresa_vinculada_id IS NULL;
  END IF;
  IF cid IS NULL THEN
    INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, email, telefono, direccion, categoria, empresa_vinculada_id)
    VALUES (propia, e.nombre, e.rnc, tipo, e.correo, e.telefono, e.direccion, e.categoria, eid);
  ELSE
    BEGIN
      UPDATE clientes SET nombre = e.nombre, rnc = e.rnc, tipo_identificacion = tipo, email = e.correo, telefono = e.telefono,
                          direccion = e.direccion, categoria = e.categoria, empresa_vinculada_id = eid
       WHERE id = cid;
    EXCEPTION WHEN unique_violation THEN
      UPDATE clientes SET nombre = e.nombre, email = e.correo, telefono = e.telefono, direccion = e.direccion,
                          categoria = e.categoria, empresa_vinculada_id = eid
       WHERE id = cid;
    END;
  END IF;
  PERFORM set_config('app.empresa_id', COALESCE(antes, ''), true);
END $$;

DROP TRIGGER empresas_sincronizar ON empresas;
CREATE TRIGGER empresas_sincronizar AFTER INSERT OR UPDATE OF nombre, rnc, tipo_identificacion, correo, telefono, direccion, firma_id, categoria
  ON empresas FOR EACH ROW EXECUTE FUNCTION empresas_sincronizar();

-- Los clientes ya enlazados toman la categoría de su ficha.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.id FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE f.empresa_propia_id IS NOT NULL AND e.id <> f.empresa_propia_id LOOP
    PERFORM sincronizar_cliente_de_firma(r.id);
  END LOOP;
END $$;
