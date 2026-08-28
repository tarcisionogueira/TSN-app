-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O PAINEL DIZIA "NINGUÉM AINDA" COM UM INSCRITO NA MESA — 28/08
--
-- A migração `eventos_live.sql` escreveu a intenção: *"Inscrição NÃO é legível pelo público
-- (…) e o dono lê pelo painel"*. A política do dono foi criada; a do ADMIN nunca. A única
-- política de SELECT era `user_id = auth.uid()`, e `Admin.jsx:11141` lê `live_inscricoes`
-- direto pelo cliente — então o dono via apenas as próprias inscrições, ou seja, ZERO.
--
-- E o painel não mostrava erro: mostrava **"Inscritos (0) — Ninguém ainda. Divulgue o link
-- acima."** Uma frase que manda gastar mais verba, apoiada numa lista que a RLS filtrou.
-- Alexandre Carmo inscreveu-se às 10:50 de 28/08 e não aparecia.
--
-- O COMENTÁRIO DA PRÓPRIA CONSULTA JÁ AVISAVA, e mira no alvo errado:
--   "A lista de inscritos é o produto desta tela. Falha aqui NÃO pode virar 'ninguém se
--    inscreveu': é a diferença entre uma aula vazia e um erro de leitura."
-- Ele guarda contra ERRO — e RLS não dá erro, devolve lista vazia com `error: null`. É a
-- forma nº 3 do CLAUDE.md ("RLS que filtra linhas NÃO é erro"), e ela derrotou uma guarda
-- escrita justamente para esse sintoma. Guardar do erro não guarda do silêncio.
--
-- `is_admin()` é o padrão usado no resto da base (analise_jobs, agente_aprendizado…).
-- 'analista' entra junto porque a lista de inscritos é material de atendimento, não só do
-- dono — mesmo critério de `alertas_email` e `aceites_plano`.
-- ─────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists live_inscricoes_equipe on public.live_inscricoes;
create policy live_inscricoes_equipe on public.live_inscricoes
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.perfis p
                where p.id = (select auth.uid()) and p.role = any (array['admin','analista']))
  );

comment on table public.live_inscricoes is
  'Inscritos da aula ao vivo. LEITURA: o proprio inscrito (live_inscricoes_dono) e a equipe (live_inscricoes_equipe). ESCRITA: so o servidor, com service key. Sem a politica da equipe o painel do admin mostra "ninguem se inscreveu" — lista vazia por RLS e indistinguivel de lista vazia de verdade.';
