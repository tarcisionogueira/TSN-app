BEGIN;

DROP POLICY IF EXISTS "eventos_live_admin" ON public.eventos_live;
DROP POLICY IF EXISTS "eventos_live_publico" ON public.eventos_live;

CREATE POLICY "eventos_live_select_consolidada" ON public.eventos_live
  AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  OR (ativo)
  );

CREATE POLICY "eventos_live_insert_consolidada" ON public.eventos_live
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "eventos_live_update_consolidada" ON public.eventos_live
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  )
  WITH CHECK (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

CREATE POLICY "eventos_live_delete_consolidada" ON public.eventos_live
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
  (EXISTS ( SELECT 1
   FROM perfis
  WHERE ((perfis.id = ( SELECT auth.uid() AS uid)) AND (perfis.role = 'admin'::text))))
  );

COMMIT;
