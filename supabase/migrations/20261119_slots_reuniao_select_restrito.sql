-- Pentest 19/11: a política de SELECT de slots_reuniao era `USING (true)` para authenticated,
-- então qualquer logado lia reservado_por (user id) e caso_id das reservas alheias. O front só
-- consulta slots com `disponivel = true`, então restringir não quebra a listagem de horários nem
-- a leitura do próprio agendamento. ALTER (não DROP) para não exigir confirmação do dono no
-- conector e por ser adição de proteção, não remoção.
alter policy slots_reuniao_select on public.slots_reuniao
  using (
    disponivel = true
    or reservado_por = (select auth.uid())
    or analista_id = (select auth.uid())
    or is_admin()
  );
