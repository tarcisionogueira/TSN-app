-- `represado: termos pendentes` É desfecho — senão o detector repete a mentira do evento (11/09)
--
-- `cliente_travou()` classifica como "começou a gerar e sumiu" todo `analise_gerar / iniciou no
-- servidor` sem `concluiu%`/`falhou%` em 30 min. O problema é que a tela emite "iniciou no
-- servidor" ANTES do gate de termos, que é quem pode recusar: a requisição nunca sai do
-- navegador, e o rastro afirma que o servidor começou. O detector estava certo e mesmo assim
-- dava o diagnóstico oposto — ele repetia fielmente o que o evento dizia (forma #10).
--
-- Medido em 11/09, dois usuários no mesmo dia: clicou em Gerar → popup de termos 3 s depois →
-- aceitou → nada. Um clicou de novo e conseguiu; o outro foi embora. O conserto do produto está
-- em `AnalisesContext` (a ação fica REPRESADA e roda sozinha no aceite, e o rastro passa a
-- gravar `represado: termos pendentes`). Esta migração é a outra metade: sem ela, o caso
-- consertado continuaria acendendo a luz vermelha do painel.
--
-- ⚠️ `represado` NÃO é sucesso — é "a pessoa foi barrada e sabe disso, com a retomada
-- engatilhada". Ele entra como DESFECHO porque encerra o silêncio, que é o que o alarme (2)
-- existe para achar. Quem fecha o popup sem aceitar deixa de aparecer aqui, e é o certo: não é
-- cliente travado por defeito nosso, é regra de negócio aguardando um aceite.
create or replace function public.cliente_travou(p_dias integer default 7)
 returns table(motivo text, gravidade text, user_id uuid, nome text, role text, tentativas bigint, primeiro timestamp with time zone, ultimo timestamp with time zone, detalhe text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with janela as (
    select greatest(now() - make_interval(days => greatest(1, p_dias)), timestamptz '2026-08-29') as de,
           -- 29/08 é o nascimento de `analise_gerar`; 10/09 o de `sessao_expirada`.
           timestamptz '2026-08-29' as nasce_gerar,
           timestamptz '2026-09-10' as nasce_sessao
  ),
  -- (1) CLICOU E A TELA RECUSOU por motivo TÉCNICO. Cota e plano NÃO entram: ali a recusa é a
  -- regra de negócio funcionando, e misturar as duas faria o alarme tocar por venda.
  recusado as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate,
           string_agg(distinct substring(e.detalhe from 'recusado: (.*)$'), '; ') motivos
      from eventos_atividade e, janela j
     where e.criado_em >= j.de and e.tipo = 'analise_gerar'
       and e.detalhe like 'recusado:%'
       and e.detalhe not like '%cota%' and e.detalhe not like '%plano%'
       and e.user_id is not null
     group by 1
  ),
  -- (2) COMEÇOU E SUMIU: o cliente registrou "iniciou no servidor" e, 30 min depois, não há
  -- desfecho no rastro NEM linha no banco. É o mais grave, porque some dos dois lados.
  sumiu as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate
      from eventos_atividade e, janela j
     where e.criado_em >= j.de and e.criado_em < now() - interval '30 minutes'
       and e.tipo = 'analise_gerar' and e.detalhe like 'iniciou%' and e.user_id is not null
       and not exists (
         select 1 from eventos_atividade f
          where f.user_id = e.user_id and f.tipo = 'analise_gerar'
            and (f.detalhe like 'concluiu%' or f.detalhe like 'falhou%' or f.detalhe like 'represado%')
            and f.criado_em between e.criado_em and e.criado_em + interval '30 minutes')
       and not exists (
         select 1 from analises_mercado a
          where a.user_id = e.user_id
            and a.created_at between e.criado_em - interval '2 minutes' and e.criado_em + interval '30 minutes')
     group by 1
  ),
  -- (3) SESSÃO VENCIDA: o servidor não reconheceu quem estava logado. Um caso isolado é
  -- normal (token expira); repetição é sintoma de que a renovação não está pegando.
  sessao as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate,
           string_agg(distinct e.alvo, ', ') alvos
      from eventos_atividade e, janela j
     where e.criado_em >= greatest(j.de, j.nasce_sessao)
       and e.tipo = 'sessao_expirada' and e.user_id is not null
     group by 1
  ),
  achados as (
    select 'clicou e a tela recusou'::text motivo, 'critico'::text gravidade, r.user_id,
           r.qtd, r.de, r.ate, coalesce(r.motivos,'(sem detalhe)') detalhe from recusado r
    union all
    select 'começou a gerar e sumiu', 'critico', s.user_id, s.qtd, s.de, s.ate,
           'nenhum desfecho no rastro e nenhuma linha em analises_mercado em 30 min' from sumiu s
    union all
    select 'sessão vencida repetida', case when x.qtd >= 3 then 'critico' else 'atencao' end,
           x.user_id, x.qtd, x.de, x.ate, coalesce(x.alvos,'') from sessao x
  )
  select a.motivo, a.gravidade, a.user_id,
         coalesce(p.nome,'(sem nome)') , coalesce(p.role,'(sem perfil)'),
         a.qtd, a.de, a.ate, a.detalhe
    from achados a left join perfis p on p.id = a.user_id
   -- O dono testando não é cliente travado: ele reporta na hora. Alarme é para quem não avisa.
   where coalesce(p.role,'') <> 'admin'
  union all
  -- A linha honesta de cobertura: aparece quando a janela pedida começa antes do instrumento.
  select '(sem cobertura)', 'aviso', null, '—', '—', 0,
         (select de from janela), (select nasce_gerar from janela),
         'a janela pedida começa antes de 29/08, quando o rastro `analise_gerar` passou a existir — o vazio antes dessa data não é ausência de casos'
   where (select now() - make_interval(days => greatest(1, p_dias)) < timestamptz '2026-08-29')
   order by 2, 6 desc;
$function$;
