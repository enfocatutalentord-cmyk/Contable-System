-- Bloque 1, entrega 1b (Sistema Empire, «sí» de Patricia del 4-nov-2026): la empresa propia de la firma, la ficha única
-- conectada con la facturación de esa empresa y las unidades de negocio en las líneas de asientos, facturas y compras.

-- ───── Empresa propia de la firma ─────
-- La contabilidad de la firma se lleva como un cliente más; esta marca dice cuál de sus empresas es la propia.
ALTER TABLE firmas ADD COLUMN empresa_propia_id uuid REFERENCES empresas(id) ON DELETE SET NULL;

-- ───── Ficha única conectada ─────
-- Cada empresa que la firma trabaja tiene su registro de cliente dentro de la facturación de la empresa propia. Ese registro
-- apunta a la empresa y copia de su ficha el nombre, el RNC, el correo, el teléfono y la dirección.
ALTER TABLE clientes ADD COLUMN empresa_vinculada_id uuid REFERENCES empresas(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX clientes_vinculada_idx ON clientes(empresa_id, empresa_vinculada_id) WHERE empresa_vinculada_id IS NOT NULL;

-- Crea o pone al día el registro de cliente de una empresa dentro de la empresa propia de su firma. Corre con los permisos
-- del dueño y fija por un momento la empresa propia para pasar el aislamiento de clientes (FORCE RLS).
CREATE FUNCTION sincronizar_cliente_de_firma(eid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  propia uuid;
  antes text := current_setting('app.empresa_id', true);
  cid uuid;
  tipo text;
BEGIN
  SELECT id, firma_id, nombre, rnc, tipo_identificacion, correo, telefono, direccion INTO e FROM empresas WHERE id = eid;
  IF e.id IS NULL OR e.firma_id IS NULL THEN RETURN; END IF;
  SELECT empresa_propia_id INTO propia FROM firmas WHERE id = e.firma_id;
  IF propia IS NULL OR propia = eid THEN RETURN; END IF;
  tipo := CASE WHEN e.rnc IS NULL THEN NULL WHEN length(e.rnc) = 9 THEN 'rnc' ELSE 'cedula' END;
  PERFORM set_config('app.empresa_id', propia::text, true);
  SELECT id INTO cid FROM clientes WHERE empresa_id = propia AND empresa_vinculada_id = eid;
  -- Si ya estaba como cliente (mismo RNC) sin vínculo, se enlaza ese en vez de crear otro.
  IF cid IS NULL AND e.rnc IS NOT NULL THEN
    SELECT id INTO cid FROM clientes WHERE empresa_id = propia AND rnc = e.rnc AND empresa_vinculada_id IS NULL;
  END IF;
  IF cid IS NULL THEN
    INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, email, telefono, direccion, empresa_vinculada_id)
    VALUES (propia, e.nombre, e.rnc, tipo, e.correo, e.telefono, e.direccion, eid);
  ELSE
    BEGIN
      UPDATE clientes SET nombre = e.nombre, rnc = e.rnc, tipo_identificacion = tipo, email = e.correo, telefono = e.telefono,
                          direccion = e.direccion, empresa_vinculada_id = eid
       WHERE id = cid;
    EXCEPTION WHEN unique_violation THEN
      -- Otro cliente sin vínculo ya tiene ese RNC: se ponen al día los demás datos y el RNC se deja como estaba.
      UPDATE clientes SET nombre = e.nombre, email = e.correo, telefono = e.telefono, direccion = e.direccion, empresa_vinculada_id = eid
       WHERE id = cid;
    END;
  END IF;
  PERFORM set_config('app.empresa_id', COALESCE(antes, ''), true);
END $$;

CREATE FUNCTION empresas_sincronizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sincronizar_cliente_de_firma(NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER empresas_sincronizar AFTER INSERT OR UPDATE OF nombre, rnc, tipo_identificacion, correo, telefono, direccion, firma_id
  ON empresas FOR EACH ROW EXECUTE FUNCTION empresas_sincronizar();

-- Al marcar la empresa propia: tiene que ser de la misma firma, y todas las demás empresas quedan como sus clientes.
CREATE FUNCTION firmas_empresa_propia() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.empresa_propia_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM empresas WHERE id = NEW.empresa_propia_id AND firma_id = NEW.id) THEN
    RAISE EXCEPTION 'La empresa propia debe ser una de las empresas de la firma' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.empresa_propia_id IS NOT DISTINCT FROM OLD.empresa_propia_id THEN RETURN NEW; END IF;
  FOR r IN SELECT id FROM empresas WHERE firma_id = NEW.id AND id <> NEW.empresa_propia_id LOOP
    PERFORM sincronizar_cliente_de_firma(r.id);
  END LOOP;
  RETURN NEW;
END $$;
-- AFTER: la sincronización lee la marca ya guardada.
CREATE TRIGGER firmas_empresa_propia AFTER INSERT OR UPDATE OF empresa_propia_id ON firmas
  FOR EACH ROW EXECUTE FUNCTION firmas_empresa_propia();

-- ───── Unidades de negocio ─────
-- Por empresa (Empire empieza con Firma contable, Laboratorio de Imperios y Sistema; un cliente puede crear las suyas).
-- La cuenta de ingreso es opcional: las líneas de factura de la unidad sin cuenta propia del producto van a ella.
CREATE TABLE unidades_negocio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  cuenta_ingreso_id uuid REFERENCES cuentas(id),
  activa boolean NOT NULL DEFAULT true,
  orden int NOT NULL DEFAULT 0,
  creada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);
ALTER TABLE unidades_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades_negocio FORCE ROW LEVEL SECURITY;
CREATE POLICY unidades_negocio_empresa ON unidades_negocio USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON unidades_negocio TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON unidades_negocio FOR EACH ROW EXECUTE FUNCTION auditar();

ALTER TABLE lineas_asiento ADD COLUMN unidad_id uuid REFERENCES unidades_negocio(id);
ALTER TABLE lineas_factura ADD COLUMN unidad_id uuid REFERENCES unidades_negocio(id);
ALTER TABLE lineas_compra ADD COLUMN unidad_id uuid REFERENCES unidades_negocio(id);
CREATE INDEX lineas_asiento_unidad_idx ON lineas_asiento(empresa_id, unidad_id) WHERE unidad_id IS NOT NULL;

-- La unidad de una línea es de la misma empresa y, si es nueva o cambia, está activa.
CREATE FUNCTION linea_unidad() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unidad_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.unidad_id IS NOT DISTINCT FROM OLD.unidad_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM unidades_negocio WHERE id = NEW.unidad_id AND empresa_id = NEW.empresa_id AND activa) THEN
    RAISE EXCEPTION 'La unidad de negocio no existe o está inactiva' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lineas_unidad BEFORE INSERT OR UPDATE OF unidad_id ON lineas_asiento FOR EACH ROW EXECUTE FUNCTION linea_unidad();
CREATE TRIGGER lineas_unidad BEFORE INSERT OR UPDATE OF unidad_id ON lineas_factura FOR EACH ROW EXECUTE FUNCTION linea_unidad();
CREATE TRIGGER lineas_unidad BEFORE INSERT OR UPDATE OF unidad_id ON lineas_compra FOR EACH ROW EXECUTE FUNCTION linea_unidad();
