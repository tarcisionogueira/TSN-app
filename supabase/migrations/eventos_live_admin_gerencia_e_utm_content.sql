-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A ABA DA AULA AO VIVO NUNCA CONSEGUIU SALVAR NADA — 27/08/2026
--
-- O dono editou o texto da bio da live e "não salvou, e não foi para o site". Não era cache
-- nem o campo faltando na leitura: `live_proxima` devolve `apresentador_bio`, e a landing o
-- renderiza. O texto ESTAVA no banco — só que gravado por service_role (migração/SQL), que
-- ignora RLS. Dava para LER o que nunca deu para ESCREVER.
--
-- `eventos_live` tinha RLS ligada e UMA política: `eventos_live_publico`, comando `r`
-- (SELECT), para anon/authenticated. **Nenhuma de UPDATE.** Todo update vindo do navegador
-- alcançava ZERO linhas — e zero linhas NÃO É ERRO: o PostgREST devolve `error: null`, o
-- Admin caía no `else`, recarregava e parecia ter salvo. Forma nº 3 do CLAUDE.md, em cima da
-- única tela que edita a aula que acontece em 6 dias.
--
-- Varrido o resto: das 10 tabelas que o front escreve, `eventos_live` era a ÚNICA sem
-- política de escrita. O dano ficou contido nela.
--
-- ⚠️ O health-check tem o item "RLS de escrita do usuário" e não pegou esta: ele procura
-- tabela onde o DONO do registro não consegue escrever, e aqui quem escreve é o ADMIN, que é
-- outra relação. O vigia existe, mas com outro escopo.
--
-- Testado como o navegador faz (role `authenticated` + JWT do admin, em transação revertida):
-- UPDATE alcançou 1 linha e gravou. Antes: 0 linhas, `error: null`, sucesso falso.
-- ─────────────────────────────────────────────────────────────────────────────────────────

drop policy if exists eventos_live_admin on public.eventos_live;
create policy eventos_live_admin on public.eventos_live
  for all to authenticated
  using (exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'admin'));

-- Sem carimbo de gravação não havia como separar "não salvou agora" de "nunca salvou" —
-- e foi isso que travou o diagnóstico por alguns minutos.
alter table public.eventos_live add column if not exists atualizado_em timestamptz;

create or replace function public.tg_eventos_live_touch()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_eventos_live_touch on public.eventos_live;
create trigger trg_eventos_live_touch
  before update on public.eventos_live
  for each row execute function public.tg_eventos_live_touch();


-- ─── utm_content / utm_term NO CADASTRO ──────────────────────────────────────────────────
-- `visita_origem` guardava os dois desde sempre; o CADASTRO nunca. Resultado: dava para saber
-- que 140 visitas vieram da campanha do Instagram, e não dava para dizer se o cadastro veio do
-- reels ou do link da bio — ou seja, não dava para comparar criativo com criativo, que é a
-- decisão que gasta verba. Pendência #26 do HANDOFF, e vira urgente na campanha da live.
alter table public.perfis
  add column if not exists mkt_utm_content text,
  add column if not exists mkt_utm_term    text;

comment on column public.perfis.mkt_utm_content is
  'Criativo/posicao que trouxe o cadastro (ex.: reels-organico, link_in_bio).';
comment on column public.perfis.mkt_utm_term is
  'Termo de busca pago (Google Ads) que gerou o cadastro.';
