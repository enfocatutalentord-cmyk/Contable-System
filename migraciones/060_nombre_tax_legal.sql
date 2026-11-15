-- 15-nov-2026: la marca pasa a «Empire Tax & Legal» (logo nuevo, «sí» de Patricia).
-- Cambia la firma de los mensajes predeterminados ya guardados y las funciones que los crean para firmas nuevas.
-- El nombre legal de la sociedad («Empire Tax’N Legal SRL», el registrado con el RNC 133-09734-6) no se toca.

UPDATE plantillas_mensaje
   SET texto = regexp_replace(texto, 'Tax’N Legal(?! SRL)', 'Tax & Legal', 'g')
 WHERE texto ~ 'Tax’N Legal(?! SRL)';

DO $$
DECLARE f oid;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = current_schema() AND p.proname IN ('crear_plantillas_mensaje', 'crear_plantillas_mensaje_extra')
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(f), 'Tax’N Legal(?! SRL)', 'Tax & Legal', 'g');
  END LOOP;
END $$;
