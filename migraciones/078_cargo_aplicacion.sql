-- Prioridad 3 · P3b · Cargo por la aplicación (propuesta del 21-nov-2026, «sí» de Patricia con las recomendadas).
-- A los clientes que usan la aplicación se les suma un porcentaje (10 % provisional, el que ponga la firma) al precio de sus servicios y de su
-- iguala. No se separa en la factura: el precio ya lo incluye. Cada factura guarda el porcentaje con el que se hizo y de ahí se calcula, sin
-- guardar nada más, cuánto de su precio es del cargo. Lo cobrado de ese cargo sale en un reporte y entra como partida del presupuesto.

-- La casilla de la ficha y su copia en la facturación de la empresa propia (la base la mantiene igual que la categoría y el tipo de cliente).
ALTER TABLE empresas ADD COLUMN usa_aplicacion boolean NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN usa_aplicacion boolean NOT NULL DEFAULT false;
-- El porcentaje de la firma (un solo valor para todos sus clientes).
ALTER TABLE firmas ADD COLUMN cargo_aplicacion numeric(5,2) NOT NULL DEFAULT 10.00 CHECK (cargo_aplicacion >= 0 AND cargo_aplicacion <= 100);
-- El porcentaje con el que se armó el precio de una factura (vacío = sin cargo). Solo facturas en pesos.
ALTER TABLE facturas ADD COLUMN cargo_app_pct numeric(5,2) CHECK (cargo_app_pct IS NULL OR (cargo_app_pct > 0 AND cargo_app_pct <= 100));

CREATE OR REPLACE FUNCTION sincronizar_cliente_de_firma(eid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  propia uuid;
  antes text := current_setting('app.empresa_id', true);
  cid uuid;
  tipo text;
BEGIN
  SELECT id, firma_id, nombre, rnc, tipo_identificacion, correo, telefono, direccion, categoria, tipo_cliente, usa_aplicacion INTO e FROM empresas WHERE id = eid;
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
    INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, email, telefono, direccion, categoria, tipo_cliente, usa_aplicacion, empresa_vinculada_id)
    VALUES (propia, e.nombre, e.rnc, tipo, e.correo, e.telefono, e.direccion, e.categoria, e.tipo_cliente, e.usa_aplicacion, eid);
  ELSE
    BEGIN
      UPDATE clientes SET nombre = e.nombre, rnc = e.rnc, tipo_identificacion = tipo, email = e.correo, telefono = e.telefono,
                          direccion = e.direccion, categoria = e.categoria, tipo_cliente = e.tipo_cliente, usa_aplicacion = e.usa_aplicacion, empresa_vinculada_id = eid
       WHERE id = cid;
    EXCEPTION WHEN unique_violation THEN
      UPDATE clientes SET nombre = e.nombre, email = e.correo, telefono = e.telefono, direccion = e.direccion,
                          categoria = e.categoria, tipo_cliente = e.tipo_cliente, usa_aplicacion = e.usa_aplicacion, empresa_vinculada_id = eid
       WHERE id = cid;
    END;
  END IF;
  PERFORM set_config('app.empresa_id', COALESCE(antes, ''), true);
END $$;

DROP TRIGGER empresas_sincronizar ON empresas;
CREATE TRIGGER empresas_sincronizar AFTER INSERT OR UPDATE OF nombre, rnc, tipo_identificacion, correo, telefono, direccion, firma_id, categoria, tipo_cliente, usa_aplicacion
  ON empresas FOR EACH ROW EXECUTE FUNCTION empresas_sincronizar();

-- El porcentaje que le toca a un cliente de la empresa en curso: el de su firma si el cliente usa la aplicación; si no, nada.
-- SECURITY DEFINER porque la empresa no lee la tabla de firmas; solo contesta por sus propios clientes.
CREATE FUNCTION cargo_aplicacion_de(cid uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN c.usa_aplicacion AND fi.cargo_aplicacion > 0 THEN fi.cargo_aplicacion END
    FROM clientes c JOIN empresas e ON e.id = c.empresa_id JOIN firmas fi ON fi.id = e.firma_id
   WHERE c.id = cid AND c.empresa_id = empresa_actual()
$$;
GRANT EXECUTE ON FUNCTION cargo_aplicacion_de(uuid) TO contable_app;

-- Cuánto del precio de una factura es el cargo: el subtotal (sin impuestos) de sus líneas con servicio de la lista por p / (100 + p).
-- Las notas de crédito no llevan cargo. Corre con el rol de la empresa (la seguridad por empresa sigue aplicando).
CREATE FUNCTION cargo_de_factura(fid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN f.cargo_app_pct IS NULL OR f.tipo_ncf IN ('B04', 'E34') THEN 0
              ELSE round(COALESCE((SELECT sum(l.subtotal) FROM lineas_factura l WHERE l.factura_id = f.id AND l.servicio_id IS NOT NULL), 0)
                         * f.cargo_app_pct / (100 + f.cargo_app_pct), 2) END
    FROM facturas f WHERE f.id = fid
$$;
GRANT EXECUTE ON FUNCTION cargo_de_factura(uuid) TO contable_app;

-- Los clientes ya enlazados toman la casilla (todos en falso: la firma decide quiénes usan la aplicación).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.id FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE f.empresa_propia_id IS NOT NULL AND e.id <> f.empresa_propia_id LOOP
    PERFORM sincronizar_cliente_de_firma(r.id);
  END LOOP;
END $$;
