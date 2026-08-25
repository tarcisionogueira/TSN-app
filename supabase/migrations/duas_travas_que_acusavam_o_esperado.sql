-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DUAS TRAVAS QUE ACUSAVAM O ESPERADO — 25/08/2026
--
-- Terceira e quarta da mesma família nesta sessão. Nenhuma das duas apontava defeito: as
-- duas descreviam o funcionamento correto com etiqueta de `bug` e limite que nunca fecha.
-- Alerta que não fecha ensina a ignorar o painel, e o painel é a defesa.
--
-- ── (A) relatorio_area_nao_confirmada: 10 contra limite 2 ────────────────────────────────
-- Media "mercado calculado sobre área não confirmada na matrícula, tendo matrícula". Fui
-- checar os 10 e:
--   • o cliente JÁ É AVISADO. `Analise.jsx` imprime, sob o valor: "Metragem de X m² conforme
--     o anúncio do leiloeiro — NÃO CONFIRMADA NA MATRÍCULA. O valor de mercado é calculado
--     sobre ela; o relatório documental lê a matrícula e confirma a área real."
--   • onde dá para comparar, a área anunciada BATE com a da matrícula: 106 × 106,72 ·
--     324 × 324 · 46,73 × 46,73 · 41,59 × 41,59 · 47,4 × 47,4.
--   • dos 10, três tinham documental — e os três foram gerados DEPOIS do mercadológico, ou
--     seja, a área confirmada não existia na hora de calcular.
-- Não há incoerência chegando ao cliente. O que a trava contava era "documental ainda não
-- pedido", que é o fluxo do produto, não um defeito — e por isso ficaria acesa para sempre.
--
-- O que MACHUCA o cliente é outra coisa: a matrícula CONTRADIZER a área usada, porque o valor
-- de mercado inteiro pendura nela. É isso que a trava passa a medir (divergência > 5%).
-- Calibrado no acervo: 6 pares comparáveis, 1 divergente histórico, 0 nos últimos 7 dias.
--
-- ── (B) limpeza_encerrados_pulada: 4 contra limite 0 ─────────────────────────────────────
-- Acusava CALIL (36 candidatos), VEGAS (20), TORRES3 (14) e PECINI (9). Medido:
--     CALIL   piso 19, último scrape OK = 11, status atual sem_cota
--     VEGAS   piso 14, último scrape OK =  4, status atual sem_cota
--     TORRES3 sem baseline,                   status atual sem_cota
--     PECINI  sem baseline,                   status atual falhou
-- E o número que decide: dos 79 candidatos, **ZERO estão encerrados por data**. Todos têm
-- praça futura. Não são lotes mortos presos no acervo — são lotes VIVOS que não foram
-- revistos numa coleta truncada por falta de cota. O freio está fazendo exatamente o que
-- deve: recusar-se a desativar em massa a partir de uma coleta incompleta. Desativá-los
-- tiraria imóvel vivo da busca do cliente.
--
-- É a armadilha do `sem_cota` que o CLAUDE.md já documenta na seção 2, por outro caminho: o
-- freio de ORÇAMENTO entregue como regressão de captura. A causa real (cota semanal saturada)
-- já tem alarme próprio e correto — `bd_teto_saturado`, hoje em 517 de 495. Duplicá-la aqui
-- com etiqueta de bug só confunde o diagnóstico.
--
-- A trava passa a exigir DUAS coisas: que a limpeza esteja pulada por motivo que NÃO seja
-- falta de cota, e que existam lotes de fato ENCERRADOS presos ativos — evidência positiva
-- de dano ao cliente, não ausência de coleta.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Cast que não derruba o painel. Área vem de JSON gerado por IA; um valor não-numérico ali
-- faria `::numeric` estourar DENTRO de qa_invariantes() — e a aba voltaria a não abrir, que é
-- exatamente o defeito consertado hoje de manhã.
create or replace function public.num_seguro(p text)
returns numeric language plpgsql immutable set search_path to 'public' as $$
begin
  return p::numeric;
exception when others then
  return null;
end $$;

comment on function public.num_seguro(text) is
  'Converte texto em numeric devolvendo NULL em vez de erro. Para ler numero de JSON gerado por IA sem derrubar quem chama.';

-- ── (B) a função da limpeza ─────────────────────────────────────────────────────────────
create or replace function public.fontes_com_limpeza_pulada(margem interval DEFAULT '36:00:00'::interval, teto_pct numeric DEFAULT 0.40)
returns table(fonte text, total bigint, candidatos bigint, encerrados bigint, pct numeric, ultimo_scrape timestamp with time zone)
language sql stable security definer set search_path to 'public' as $function$
  -- ESPELHA A DECISAO REAL de desativar_imoveis_leiloeiro_stale: a fonte e pulada quando NAO
  -- tem baseline aprendido ou quando a ULTIMA coleta veio abaixo do piso.
  -- 25/08: duas exigencias novas. (1) status 'sem_cota' NAO conta — e decisao de orcamento,
  -- ja reportada por bd_teto_saturado, e trata-la como regressao de captura manda consertar
  -- parser intacto. (2) so conta fonte com lote de fato ENCERRADO preso ativo: evidencia
  -- positiva de dano ao cliente. Lote com praca FUTURA nao revisto e o freio protegendo,
  -- nao defeito — medido em 25/08: 79 candidatos, 0 encerrados.
  with ult as (
    select i.fonte, max(i.atualizado_em) as ultimo, count(*) as total
      from public.imoveis_leilao i
     where i.ativo and i.fonte is not null
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual')
     group by i.fonte
      having max(i.atualizado_em) > now() - interval '10 days'
  ),
  m as (
    select u.fonte, u.total, u.ultimo,
           (select count(*) from public.imoveis_leilao x
             where x.ativo and x.fonte = u.fonte and x.atualizado_em < u.ultimo - margem) as cand,
           (select count(*) from public.imoveis_leilao x
             where x.ativo and x.fonte = u.fonte and x.atualizado_em < u.ultimo - margem
               and public.leilao_encerrado(x.modalidade, x.data_leilao, x.data_leilao_2, x.data_fim)) as enc,
           (select s.status from public.fonte_saude s
             where s.fonte = u.fonte order by s.executado_em desc limit 1) as status_atual
      from ult u
  )
  select m.fonte, m.total, m.cand, m.enc,
         round(m.cand::numeric / nullif(m.total,0), 3), m.ultimo
    from m
    left join public.fonte_baseline_aprendida() b on b.fonte = m.fonte
   where (not coalesce(b.tem_baseline, false)
          or coalesce((select s.total from public.fonte_saude s
                        where s.fonte = m.fonte and s.status = 'ok'
                        order by s.executado_em desc limit 1), 0) < coalesce(b.ativos_piso, 0))
     and coalesce(m.status_atual, '') <> 'sem_cota'   -- ⬅️ orcamento nao e regressao
     and m.enc > 0                                    -- ⬅️ so com dano medido, nao com ausencia
   order by 4 desc, 3 desc;
$function$;

-- ── (A) o invariante do relatório ───────────────────────────────────────────────────────
do $do$
declare def text; ini int; fim int; novo text;
  ancora_ini text := '     (''relatorio_area_nao_confirmada'',';
  ancora_fim text := 'like ''%"matricula"%'')), 2),';
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('num_seguro' in def) > 0 then raise notice 'ja aplicado — nada a fazer'; return; end if;
  ini := position(ancora_ini in def);
  if ini = 0 then raise exception 'ancora inicial nao encontrada — revise antes de aplicar'; end if;
  fim := position(ancora_fim in substring(def from ini));
  if fim = 0 then raise exception 'ancora final nao encontrada — revise antes de aplicar'; end if;

  novo :=
'     (''relatorio_area_nao_confirmada'',''Mercado calculado sobre area que a matricula CONTRADIZ (>5%)'',''Relatório'',''bug'',
       (select count(*) from analises_mercado a
          join analises_documental d on d.imovel_id::text = a.imovel_id::text
                                    and d.user_id = a.user_id and d.status = ''concluida''
         where a.status = ''concluida'' and a.created_at > now() - interval ''7 days''
           and coalesce(a.result->''mercado''->''metodologia''->''area''->>''fonte'','''') <> ''matricula''
           and public.num_seguro(a.result->''mercado''->''metodologia''->''area''->>''valor'') is not null
           and coalesce(nullif(public.num_seguro(d.result->''extracao''->>''areaPrivativaM2''), 0),
                        nullif(public.num_seguro(d.result->''extracao''->>''areaTotalM2''), 0)) is not null
           and abs(public.num_seguro(a.result->''mercado''->''metodologia''->''area''->>''valor'')
                 - coalesce(nullif(public.num_seguro(d.result->''extracao''->>''areaPrivativaM2''), 0),
                            nullif(public.num_seguro(d.result->''extracao''->>''areaTotalM2''), 0)))
               / coalesce(nullif(public.num_seguro(d.result->''extracao''->>''areaPrivativaM2''), 0),
                          nullif(public.num_seguro(d.result->''extracao''->>''areaTotalM2''), 0)) > 0.05), 0),';

  def := left(def, ini - 1) || novo || substring(def from ini + fim - 1 + length(ancora_fim));
  execute def;
  raise notice 'invariante passa a medir contradicao, nao ausencia';
end $do$;

-- ── VERIFICADO ──────────────────────────────────────────────────────────────────────────
--   (A) hoje 0. Com a area de um relatorio DOBRADA (divergindo da matricula): 1. Os dois
--       sentidos, em transacao desfeita.
--   (B) hoje 0. As 4 fontes saem porque 3 estao em sem_cota e nenhuma tem lote encerrado
--       preso ativo (79 candidatos, 0 encerrados).
