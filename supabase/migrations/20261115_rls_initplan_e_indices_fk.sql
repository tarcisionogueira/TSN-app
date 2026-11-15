-- 15/11 — Advisor de desempenho do Supabase: `auth_rls_initplan` (7 políticas) e `unindexed_foreign_keys` (9).
--
-- (1) auth.uid() dentro da política é reavaliado POR LINHA; `(select auth.uid())` vira initPlan e roda
--     uma vez por consulta. Mesma regra lógica, só a forma muda (ALTER POLICY, nada é removido).
-- (2) FKs sem índice: as tabelas são pequenas hoje, mas sem índice o DELETE/UPDATE da tabela-mãe varre a
--     filha inteira (e trava). Índice simples na coluna da FK.

alter policy documentos_aguardando_le_proprio on public.documentos_aguardando
  using (user_id = (select auth.uid()));

alter policy caso_andamentos_cliente_le on public.caso_andamentos
  using (visivel_cliente and (
    exists (select 1 from public.arrematados a where a.id = caso_andamentos.arrematado_id and a.user_id = (select auth.uid()))
    or exists (select 1 from public.casos c where c.id = caso_andamentos.caso_id and c.cliente_id = (select auth.uid()))
  ));

alter policy marketing_canal_pausa_admin on public.marketing_canal_pausa
  using (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy favoritos_dono_le     on public.favoritos using (user_id = (select auth.uid()));
alter policy favoritos_dono_insere on public.favoritos with check (user_id = (select auth.uid()));
alter policy favoritos_dono_apaga  on public.favoritos using (user_id = (select auth.uid()));

alter policy favorito_lance_le on public.favorito_lance
  using (exists (select 1 from public.favoritos f
                  where f.user_id = (select auth.uid()) and f.tipo = favorito_lance.tipo and f.item_id = favorito_lance.item_id));

create index if not exists arremate_confirmacao_por_idx            on public.arremate_confirmacao (por);
create index if not exists caso_andamentos_autor_id_idx            on public.caso_andamentos (autor_id);
create index if not exists caso_documentos_email_id_idx            on public.caso_documentos (email_id);
create index if not exists qa_invariante_explicada_imovel_id_idx   on public.qa_invariante_explicada (imovel_id);
create index if not exists servicos_cartorio_catalogo_id_idx       on public.servicos_cartorio (catalogo_id);
create index if not exists servicos_cartorio_cliente_id_idx        on public.servicos_cartorio (cliente_id);
create index if not exists servicos_cartorio_criado_por_idx        on public.servicos_cartorio (criado_por);
create index if not exists servicos_cartorio_mensagens_autor_id_idx on public.servicos_cartorio_mensagens (autor_id);
create index if not exists veiculos_email_sinal_veiculo_id_idx     on public.veiculos_email_sinal (veiculo_id);
