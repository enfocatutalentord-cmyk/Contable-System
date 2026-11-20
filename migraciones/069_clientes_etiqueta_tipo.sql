-- Prioridad 2.2 (P2c.1): el tipo de cliente de la ficha llega a la facturación de la propia (para usarlo al facturar), la casilla «Los asientos
-- requieren aprobación» desaparece (la reemplazan los permisos con aprobación de la P2a) y las empresas en constitución llevan nombre provisional.

ALTER TABLE clientes ADD COLUMN tipo_cliente text;

CREATE OR REPLACE FUNCTION sincronizar_cliente_de_firma(eid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  propia uuid;
  antes text := current_setting('app.empresa_id', true);
  cid uuid;
  tipo text;
BEGIN
  SELECT id, firma_id, nombre, rnc, tipo_identificacion, correo, telefono, direccion, categoria, tipo_cliente INTO e FROM empresas WHERE id = eid;
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
    INSERT INTO clientes (empresa_id, nombre, rnc, tipo_identificacion, email, telefono, direccion, categoria, tipo_cliente, empresa_vinculada_id)
    VALUES (propia, e.nombre, e.rnc, tipo, e.correo, e.telefono, e.direccion, e.categoria, e.tipo_cliente, eid);
  ELSE
    BEGIN
      UPDATE clientes SET nombre = e.nombre, rnc = e.rnc, tipo_identificacion = tipo, email = e.correo, telefono = e.telefono,
                          direccion = e.direccion, categoria = e.categoria, tipo_cliente = e.tipo_cliente, empresa_vinculada_id = eid
       WHERE id = cid;
    EXCEPTION WHEN unique_violation THEN
      UPDATE clientes SET nombre = e.nombre, email = e.correo, telefono = e.telefono, direccion = e.direccion,
                          categoria = e.categoria, tipo_cliente = e.tipo_cliente, empresa_vinculada_id = eid
       WHERE id = cid;
    END;
  END IF;
  PERFORM set_config('app.empresa_id', COALESCE(antes, ''), true);
END $$;

DROP TRIGGER empresas_sincronizar ON empresas;
CREATE TRIGGER empresas_sincronizar AFTER INSERT OR UPDATE OF nombre, rnc, tipo_identificacion, correo, telefono, direccion, firma_id, categoria, tipo_cliente
  ON empresas FOR EACH ROW EXECUTE FUNCTION empresas_sincronizar();

-- Los clientes ya enlazados toman el tipo de cliente de su ficha.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.id FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE f.empresa_propia_id IS NOT NULL AND e.id <> f.empresa_propia_id LOOP
    PERFORM sincronizar_cliente_de_firma(r.id);
  END LOOP;
END $$;

-- Sin la casilla no hay cómo apagarla: las aprobaciones ahora se piden por persona (permisos con aprobación).
UPDATE empresas SET requiere_aprobacion = false WHERE requiere_aprobacion;

-- Empresa en constitución: nombre provisional y sin RNC hasta que ONAPI y la DGII aprueben.
ALTER TABLE empresas ADD COLUMN nombre_provisional boolean NOT NULL DEFAULT false;
