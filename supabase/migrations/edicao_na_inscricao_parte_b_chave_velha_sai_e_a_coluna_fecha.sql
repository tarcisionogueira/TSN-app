-- ══════════════════════════════════════════════════════════════════════════════════════
-- A EDIÇÃO ENTRA NA INSCRIÇÃO — parte B. APLICAR SÓ DEPOIS DO DEPLOY DA PARTE A ESTAR READY.
-- ══════════════════════════════════════════════════════════════════════════════════════
-- A parte A adicionou a coluna, o gatilho e as chaves NOVAS, deixando as velhas no lugar para
-- que o código então em produção (upsert com `on_conflict=evento_id,email`) continuasse
-- funcionando durante o deploy. Esta parte fecha o serviço:
--
--   • derruba o UNIQUE (evento_id, email) de `live_inscricoes` — é ELE que impedia a MESMA
--     pessoa de se inscrever na aula da semana seguinte. Enquanto ele existir, o upsert do
--     código novo encontra a linha de 02/09 e apenas a atualiza: a inscrição de 09/09
--     responde 200 sem existir como linha própria, e a pessoa não entra em nenhuma lista da
--     nova edição. Uma inscrição que "deu certo" e não está em lista nenhuma é a forma nº 1
--     do CLAUDE.md — o desfecho de sucesso entregue no lugar do que não aconteceu;
--   • derruba o UNIQUE (evento_id, email, etapa) de `live_lembretes`, pelo mesmo motivo: com
--     ele, o lembrete da véspera de 09/09 colide com o de 02/09 e quem ESTÁ inscrito fica sem
--     o link da sala — e o `insert` que falha só aparece como um `console.error` no log;
--   • fecha as duas colunas em NOT NULL. Só é seguro porque o gatilho
--     `live_edicao_preencher` (parte A) garante o valor em todo INSERT, venha ele do
--     aplicativo, do `/admin` ou da mão de alguém no SQL Editor.
--
-- ⚠️ CONFERE ANTES DE DERRUBAR. Se o deploy do código novo ainda não estiver no ar, o upsert
-- em produção aponta para a chave velha e passaria a tomar 400 — que a rota de inscrição
-- devolve ao cliente como "Não conseguimos concluir a sua inscrição". A conferência abaixo
-- recusa em vez de seguir: as chaves novas TÊM de existir (a parte A rodou) e nenhuma linha
-- pode estar sem edição.

do $$
declare n_ins int; n_lem int; tem_ins boolean; tem_lem boolean;
begin
  select count(*) into n_ins from public.live_inscricoes where edicao is null;
  select count(*) into n_lem from public.live_lembretes  where edicao is null;
  select exists (select 1 from pg_indexes where schemaname='public' and indexname='live_inscricoes_evento_email_edicao_key') into tem_ins;
  select exists (select 1 from pg_indexes where schemaname='public' and indexname='live_lembretes_evento_email_etapa_edicao_key') into tem_lem;

  if not tem_ins or not tem_lem then
    raise exception 'parte A não aplicada (índices novos ausentes) — não derrube as chaves velhas';
  end if;
  if n_ins > 0 or n_lem > 0 then
    raise exception 'ainda há % inscrição(ões) e % lembrete(s) sem edição — o NOT NULL falharia', n_ins, n_lem;
  end if;
end $$;

alter table public.live_inscricoes drop constraint if exists live_inscricoes_evento_id_email_key;
alter table public.live_lembretes  drop constraint if exists live_lembretes_evento_id_email_etapa_key;

alter table public.live_inscricoes alter column edicao set not null;
alter table public.live_lembretes  alter column edicao set not null;
