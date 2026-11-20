-- Prioridad 1.1 del «Prompt para el programador» de Patricia (20-nov-2026, «sí» con las respuestas recomendadas): sus empresas llevan
-- contabilidad completa y no son clientes. Son tres (Empire Tax'N Legal, Rojas Investment Group y Mora Paulino Servicios Múltiples) y
-- se trabajan desde «Contabilidad» en el menú. Empire sigue siendo la que factura a los clientes de la firma (firmas.empresa_propia_id).
-- No se borra ni se mueve ningún dato: una empresa que estaba como cliente solo cambia de lugar.

ALTER TABLE empresas ADD COLUMN contabilidad_propia boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN empresas.contabilidad_propia IS 'Empresa de la dueña de la firma: contabilidad completa, fuera de la lista de clientes';

UPDATE empresas e SET contabilidad_propia = true, lleva_contabilidad = true
  FROM firmas f WHERE f.empresa_propia_id = e.id;

-- La que factura a los clientes siempre es una de las propias.
CREATE FUNCTION marcar_contabilidad_propia() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.empresa_propia_id IS NOT NULL THEN
    UPDATE empresas SET contabilidad_propia = true, lleva_contabilidad = true
     WHERE id = NEW.empresa_propia_id AND NOT (contabilidad_propia AND lleva_contabilidad);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firmas_contabilidad_propia AFTER INSERT OR UPDATE OF empresa_propia_id ON firmas
  FOR EACH ROW EXECUTE FUNCTION marcar_contabilidad_propia();

-- Las propias llevan contabilidad (con asientos) aunque no sean la que factura.
CREATE OR REPLACE FUNCTION empresa_lleva_contabilidad() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT e.lleva_contabilidad OR e.contabilidad_propia OR e.id IS NOT DISTINCT FROM f.empresa_propia_id
                     FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.id = empresa_actual()), true);
$$;
CREATE OR REPLACE FUNCTION lleva_contabilidad(eid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT e.lleva_contabilidad OR e.contabilidad_propia OR e.id IS NOT DISTINCT FROM f.empresa_propia_id
                     FROM empresas e JOIN firmas f ON f.id = e.firma_id WHERE e.id = eid), true);
$$;

-- Datos de la firma de producción (respuesta recomendada 5): hoy no tienen RNC. Solo si siguen vacíos.
UPDATE firmas SET nombre = 'Empire Tax & Legal', rnc = '133097346'
 WHERE id = '0a1d39db-91dd-4abf-9091-5c71c8fe4e7f' AND (rnc IS NULL OR rnc = '');
