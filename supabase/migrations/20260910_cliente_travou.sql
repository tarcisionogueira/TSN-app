-- ═══════════════════════════════════════════════════════════════════════════════════════
-- public.cliente_travou(dias) — "alguém tentou usar o produto e não saiu nada?"
--
-- POR QUE EXISTE (10/09). Num dia só, quatro defeitos diferentes tinham a MESMA assinatura:
-- a tela parecia funcional e estava vazia por dentro, e o único que descobria era o cliente,
-- clicando. Nenhum deles apareceu em revisão de código — só no rastro que deixaram no banco:
--   • Neuma (pagante): QUATORZE cliques em "Gerar" em 8 minutos, todos "recusado: imovel sem
--     endereco/cidade", num lote que tem endereço, bairro, cidade, UF e coordenadas;
--   • Leonardo Oliveira (31/08): clicou, o cliente registrou "iniciou no servidor",
--     e NENHUMA linha foi criada em analises_mercado. Sumiu sem erro;
--   • sessão vencida rebaixando admin a cliente comum, sem rastro nenhum;
--   • cota não lida virando "0" na tela.
--
-- A lição do CLAUDE.md aplicada: varredura de código não pega isso. O que pega é perguntar ao
-- BANCO o que aconteceu com gente de verdade. Custo zero, roda no ritual E no health-check
-- (2×/dia, e-mail automático — o cliente travado deixa de depender de reclamação para aparecer).
--
-- ⚠️ A FUNÇÃO NÃO INVENTA COBERTURA. Cada sinal tem data de nascimento (o evento não existia
-- antes), e ela devolve `motivo='(sem cobertura)'` para a janela que começa antes disso — em vez
-- de devolver vazio e deixar quem lê concluir "não houve nenhum caso". Um zero de instrumento
-- cego é a forma nº 10, e ela já foi cometida dentro de um verificador desta base antes.
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cliente_travou(p_dias integer DEFAULT 7)
 RETURNS TABLE(motivo text, gravidade text, user_id uuid, nome text, role text, tentativas bigint, primeiro timestamp with time zone, ultimo timestamp with time zone, detalhe text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- desfecho no rastro NEM linha no banco. É o caso do Leonardo — o mais grave, porque some
  -- silenciosamente dos dois lados.
  sumiu as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate
      from eventos_atividade e, janela j
     where e.criado_em >= j.de and e.criado_em < now() - interval '30 minutes'
       and e.tipo = 'analise_gerar' and e.detalhe like 'iniciou%' and e.user_id is not null
       and not exists (
         select 1 from eventos_atividade f
          where f.user_id = e.user_id and f.tipo = 'analise_gerar'
            and (f.detalhe like 'concluiu%' or f.detalhe like 'falhou%')
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

comment on function public.cliente_travou(int) is
  'Quem tentou usar o produto e não saiu nada. Verde = vazio. Ver o cabeçalho da função para a origem (10/09).';

revoke all on function public.cliente_travou(int) from public, anon;
grant execute on function public.cliente_travou(int) to authenticated, service_role;
