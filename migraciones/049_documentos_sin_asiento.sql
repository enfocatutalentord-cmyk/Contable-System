-- Rediseño, n.º 9 de la Lista de rediseños (Patricia, 6-nov-2026): las facturas y compras de un cliente sin contabilidad son un
-- registro para impuestos. Al emitirlas o registrarlas, y al cobrarlas o pagarlas, no se hace asiento. Lo que ya existe no cambia.
-- El 606, 607, 608, IT-1 e IR-17 ya salían de los documentos (fecha y forma del pago, retenciones), no de los asientos.

-- ¿Lleva contabilidad la empresa? (la propia de la firma siempre; un cliente, si lo tiene marcado). Para los triggers.
CREATE FUNCTION lleva_contabilidad(eid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT e.lleva_contabilidad OR e.id IS NOT DISTINCT FROM f.empresa_propia_id
                     FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.id = eid), true);
$$;
GRANT EXECUTE ON FUNCTION lleva_contabilidad(uuid) TO contable_app;

-- Un documento vigente puede no tener asiento.
ALTER TABLE facturas DROP CONSTRAINT facturas_emision_check;
ALTER TABLE facturas ADD CONSTRAINT facturas_emision_check CHECK (
  (estado = 'emitida' AND ncf IS NOT NULL AND (ncf_vence IS NOT NULL OR ncf_externo IS NOT NULL))
  OR (estado = 'borrador' AND ncf IS NULL AND asiento_id IS NULL AND NOT anulada));
ALTER TABLE compras DROP CONSTRAINT compras_registro_check;
ALTER TABLE compras ADD CONSTRAINT compras_registro_check CHECK (
  (estado = 'registrada' AND ncf IS NOT NULL)
  OR (estado = 'borrador' AND asiento_id IS NULL AND NOT anulada));
ALTER TABLE pagos ALTER COLUMN asiento_id DROP NOT NULL;
ALTER TABLE pagos ALTER COLUMN cuenta_origen_id DROP NOT NULL;
ALTER TABLE cobros ALTER COLUMN cuenta_destino_id DROP NOT NULL;

-- Sin asiento: solo si la empresa no lleva contabilidad, y nada se emite, registra, cobra, paga ni anula en período cerrado (la regla
-- que con asiento cuida el trigger de asientos, como las «lock dates» de Xero).
CREATE FUNCTION documento_sin_asiento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  vigente boolean;
  cambio boolean;
  bloqueo date;
BEGIN
  vigente := CASE TG_TABLE_NAME WHEN 'facturas' THEN n->>'estado' = 'emitida' WHEN 'compras' THEN n->>'estado' = 'registrada' ELSE true END;
  IF NOT vigente OR NEW.asiento_id IS NOT NULL THEN RETURN NEW; END IF;
  IF lleva_contabilidad(NEW.empresa_id) THEN
    RAISE EXCEPTION 'Esta empresa lleva contabilidad: el documento necesita su asiento' USING ERRCODE = 'check_violation';
  END IF;
  cambio := TG_OP = 'INSERT' OR (n->>'estado') IS DISTINCT FROM (o->>'estado')
         OR COALESCE(n->>'anulada', n->>'anulado') IS DISTINCT FROM COALESCE(o->>'anulada', o->>'anulado');
  IF cambio THEN
    SELECT fecha_bloqueo INTO bloqueo FROM empresas WHERE id = NEW.empresa_id;
    IF bloqueo IS NOT NULL AND (n->>'fecha')::date <= bloqueo THEN
      RAISE EXCEPTION 'El período está cerrado hasta el %: no se emite, registra, cobra, paga ni anula nada con esa fecha', to_char(bloqueo, 'DD/MM/YYYY')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facturas_sin_asiento BEFORE INSERT OR UPDATE ON facturas FOR EACH ROW EXECUTE FUNCTION documento_sin_asiento();
CREATE TRIGGER compras_sin_asiento BEFORE INSERT OR UPDATE ON compras FOR EACH ROW EXECUTE FUNCTION documento_sin_asiento();
CREATE TRIGGER cobros_sin_asiento BEFORE INSERT OR UPDATE ON cobros FOR EACH ROW EXECUTE FUNCTION documento_sin_asiento();
CREATE TRIGGER pagos_sin_asiento BEFORE INSERT OR UPDATE ON pagos FOR EACH ROW EXECUTE FUNCTION documento_sin_asiento();
