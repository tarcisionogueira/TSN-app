-- 30/08 — O INVARIANTE QUE EU CRIEI DE MANHÃ IA GRITAR PARA SEMPRE
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `caso_sem_analise_iniciada` (criado hoje) conta caso aberto há 7+ dias sem NENHUM job.
-- Com o motor no ar e os jobs criados, sobraram 5 casos na conta — e os 5 têm o LEILÃO
-- ENCERRADO há semanas (praças de 20/07 a 06/08). Nenhum deles vai ganhar job algum: o
-- próprio produto recusa gerar relatório de lote vencido (`leilaoEncerrado` na tela,
-- `api/_leilao-encerrado.js` no servidor, e a faixa "Leilão encerrado… novos relatórios não
-- são gerados para este lote").
--
-- Ou seja: um alarme que NÃO TEM COMO ficar verde. É a fabricação de ruído — exatamente o que
-- o runner já registrou na lição da CREPALDI ("alarme sobre resposta correta é o que treina o
-- dono a ignorar o painel") e o que o `sem_cota`/`vazio` do `_saude-fonte.mjs` existem para
-- evitar. Um invariante que mede "cliente esperando trabalho" não pode contar caso morto.
--
-- A REGRA AQUI ESPELHA A DO PRODUTO, não uma minha. Ver `src/utils/leilaoEncerrado.js`:
--   • encerrado = a MAIS FUTURA de todas as datas conhecidas já passou. Só a 1ª praça ter
--     vencido é NORMAL (é quando a 2ª, mais barata, interessa) — por isso o `greatest` das
--     cinco colunas, e não `data_leilao` sozinha.
--   • VENDA DIRETA nunca encerra por data (na Caixa é venda contínua; 1.674 lotes carregam
--     data velha que a CEF não atualiza). Fica de fora do encerramento.
--   • Sem data confiável, NÃO encerra — a falha é aberta. Impedir/ocultar por falta de
--     informação é pior que deixar passar. É por isso que o caso judicial de Guarulhos
--     (`a82825e0`, sem data nenhuma) continua contando se ficar sem job.
--   • Data sem hora vale até o FIM DO DIA em Brasília: `+ interval '1 day'` sobre a data,
--     senão um leilão marcado para hoje apareceria vencido desde a meia-noite.
create or replace function public.qa_invariante_caso_sem_analise_iniciada()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint
    from public.casos c
    left join public.perfis p on p.id = c.cliente_id
    left join public.imoveis_leilao i on i.id::text = c.imovel_id
   where c.status_etapa = 'analise_solicitada'
     and c.created_at < now() - interval '7 days'
     and coalesce(p.role, '') <> 'admin'
     and not exists (select 1 from public.analise_jobs j where j.caso_id = c.id)
     and not (
       -- LEILÃO ENCERRADO pela régua do produto. `nullif(...,'')::date` tolera o texto cru de
       -- `data_leilao`; qualquer coluna ilegível vira NULL e simplesmente não conta como data.
       coalesce(i.modalidade, '') !~* 'venda[_ -]?direta'
       and greatest(
             coalesce(nullif(left(coalesce(i.data_leilao,''),10),'')::date, '-infinity'::date),
             coalesce(i.data_leilao_2::date, '-infinity'::date),
             coalesce(i.data_fim::date,      '-infinity'::date),
             coalesce(i.praca1_fim::date,    '-infinity'::date),
             coalesce(i.praca2_fim::date,    '-infinity'::date)
           ) > '-infinity'::date
       and greatest(
             coalesce(nullif(left(coalesce(i.data_leilao,''),10),'')::date, '-infinity'::date),
             coalesce(i.data_leilao_2::date, '-infinity'::date),
             coalesce(i.data_fim::date,      '-infinity'::date),
             coalesce(i.praca1_fim::date,    '-infinity'::date),
             coalesce(i.praca2_fim::date,    '-infinity'::date)
           ) + interval '1 day' < now() at time zone 'America/Sao_Paulo'
     );
$$;
