-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O FUNIL CONTAVA NAVEGADOR E CHAMAVA DE PESSOA — E PARAVA ANTES DO BURACO — 29/08
--
-- O dono olhou a tela e leu, de cima para baixo: 2.234 → 1.699 → 85 → 99 → 34 → 71.
-- "Criaram conta 71" MAIOR que "Tentaram criar conta 34" é aritmeticamente impossível num
-- funil encaixado, e a impossibilidade é o sintoma de DOIS instrumentos medindo outra coisa
-- (a forma nº 10 do CLAUDE.md: o número é plausível e descreve outro fenômeno).
--
--   1. `virou_conta` contava `anon_id` DISTINTO que em algum momento apareceu com `user_id`.
--      Medido em 29/08 na janela de 30 dias: 71 navegadores ↔ 57 pessoas ↔ 52 delas com
--      conta criada DENTRO da janela. Ou seja: quem entrou do celular e do desktop contava
--      duas vezes, e CLIENTE ANTIGO que só fez login contava como "criou conta". Um degrau
--      de aquisição inflado por reincidência de quem já é cliente — exatamente o oposto do
--      que o painel promete ("quem AINDA NÃO é cliente").
--      Passa a contar PESSOA (`user_id` distinto) cuja conta nasceu na janela e cuja visita
--      anônima foi medida: 45. Continua sendo PISO (quem trocou de aparelho não entra), e
--      `contas_criadas_total` (54) passa a vir junto para mostrar o teto.
--
--   2. `tentou` exigia `user_id is null` no evento de `submit`. Só que o rastreador carimba
--      o `user_id` assim que a sessão existe — e o cadastro bem-sucedido CRIA a sessão. Em
--      parte dos navegadores o submit que deu certo já chegava identificado e caía fora da
--      conta. Resultado: 34, abaixo dos 45 que de fato criaram conta. O filtro certo é pelo
--      CONJUNTO de anônimos da janela (é o funil deles), não pelo estado do evento: 52.
--
--   3. O funil PARAVA em "criou conta" — e o buraco do negócio está DEPOIS. Das 45 contas
--      novas, 4 geraram algum relatório. 91% cadastram e nunca usam o produto. Enquanto o
--      degrau não estava na tela, a leitura natural era "a aquisição vai bem" — e vai: 2,4%
--      de visitante para conta é número saudável. O que não vai é a ativação.
--
-- Nada aqui muda coleta: os três números sempre estiveram no rastro. Mudou o que a consulta
-- pergunta a ele.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.funil_publico(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_role text;
  corte timestamptz := now() - (greatest(p_dias, 1) || ' days')::interval;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if coalesce(v_role,'') not in ('admin','analista') then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'dias', greatest(p_dias, 1),
    'degraus', (
      with anon as (
        select distinct anon_id from public.eventos_atividade
         where user_id is null and anon_id is not null and criado_em > corte
      ),
      -- PONTE PRÉ-LOGIN, agora por PESSOA e só de conta NOVA. O `distinct user_id` é o que
      -- impede o mesmo humano de contar uma vez por navegador; o `p.created_at > corte` é o
      -- que impede cliente antigo de aparecer como aquisição.
      virou as (
        select distinct e.user_id
          from public.eventos_atividade e
          join public.perfis p on p.id = e.user_id
         where e.anon_id in (select anon_id from anon)
           and e.user_id is not null
           and p.created_at > corte
      ),
      com_erro as (
        select distinct anon_id from public.eventos_atividade
         where user_id is null and tipo='api_erro' and criado_em > corte
      ),
      passo as (
        select
          (select count(*) from anon) as visitantes,
          -- `/leiloes%` é a LISTAGEM e `/leilao%` é a página do LOTE: as duas são acervo
          -- público. Contar só o plural deixava de fora exatamente onde o SEO de cauda longa
          -- entrega gente — pego no primeiro dado real, uma visita orgânica em Araxá/MG.
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte
              and (rota like '/leiloes%' or rota like '/leilao%')) as viu_acervo,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and rota = '/planos') as viu_planos,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and rota = '/login') as foi_ao_cadastro,
          -- Sem `user_id is null`: o submit que DÁ CERTO já chega identificado (o cadastro
          -- cria a sessão antes de o evento subir). O recorte é o conjunto de anônimos.
          (select count(distinct anon_id) from public.eventos_atividade
            where anon_id in (select anon_id from anon)
              and tipo = 'submit' and rota = '/login') as tentou,
          (select count(*) from virou) as virou_conta,
          -- O DEGRAU QUE FALTAVA: das contas novas, quantas produziram o ato central do
          -- produto. É aqui que o funil realmente vaza.
          (select count(*) from virou v
            where exists (select 1 from public.analises_mercado a where a.user_id = v.user_id)) as gerou_relatorio,
          -- Teto honesto: contas nascidas na janela, inclusive quem trocou de aparelho e não
          -- pôde ser ligado à visita. `virou_conta` <= este número, sempre.
          (select count(*) from public.perfis where created_at > corte) as contas_criadas_total,
          (select count(*) from com_erro) as tomou_erro,
          -- O NÚMERO QUE IMPORTA: tomou erro E nunca virou conta. Sem ele, `tomou_erro` é lido
          -- como perda — e não é. Medido em 12/08: 10 erraram em 30 dias e 8 entraram assim
          -- mesmo (a maioria por "Email not confirmed", que é a pessoa tentando logar antes de
          -- clicar no link do e-mail: transitório). Perda real = 2.
          (select count(*) from com_erro c
            where not exists (select 1 from public.eventos_atividade v
                               where v.anon_id = c.anon_id and v.user_id is not null)) as desistiu_apos_erro
      )
      select to_jsonb(passo) from passo),
    -- ORIGEM POR CAMPANHA: sai de `visita_origem` (gclid/UTM do primeiro toque). Cada linha
    -- traz quantos CHEGARAM e quantos viraram CONTA — que é o que responde "esta campanha vale
    -- o que custa". O fallback '(não medido)' cobre a visita anterior a 12/08, quando a query
    -- string era descartada em todo o caminho; chamar aquilo de tráfego direto seria mentira.
    'origens', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.pessoas desc) from (
        select coalesce(
                 case when o.gclid is not null or o.gbraid is not null or o.wbraid is not null
                        then coalesce('Google Ads · ' || nullif(o.utm_campaign,''), 'Google Ads')
                      when nullif(o.utm_source,'') is not null
                        then o.utm_source || coalesce(' · ' || nullif(o.utm_campaign,''), '')
                      when nullif(o.referrer_host,'') is not null then o.referrer_host || ' (orgânico)'
                 end, '(não medido)') as origem,
               count(distinct a.anon_id) as pessoas,
               count(distinct a.anon_id) filter (
                 where exists (select 1 from public.eventos_atividade v
                                where v.anon_id = a.anon_id and v.user_id is not null)) as viraram_conta
          from (select distinct anon_id from public.eventos_atividade
                 where user_id is null and anon_id is not null and criado_em > corte) a
          left join public.visita_origem o on o.anon_id = a.anon_id
         group by 1 order by 2 desc limit 10) g), '[]'::jsonb),
    'paginas', coalesce((
      select jsonb_agg(x) from (
        select rota, count(distinct anon_id) as pessoas
          from public.eventos_atividade
         where user_id is null and tipo = 'pageview' and criado_em > corte
         group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'barreiras', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.perdeu desc, g.pessoas desc)
        from (
          select case when e.alvo = 'cadastro_falha' then 'Criar conta'
                      when e.alvo = 'login_falha'    then 'Entrar'
                      else 'Uso do site' end                          as etapa,
                 left(coalesce(e.detalhe,''), 120)                    as motivo,
                 count(*)                                             as vezes,
                 count(distinct e.anon_id)                            as pessoas,
                 -- PERDA REAL desta barreira: das que a tomaram, quantas nunca viraram conta.
                 count(distinct e.anon_id) filter (
                    where not exists (select 1 from public.eventos_atividade v
                                       where v.anon_id = e.anon_id and v.user_id is not null)) as perdeu
            from public.eventos_atividade e
           where e.user_id is null and e.tipo = 'api_erro' and e.criado_em > corte
           group by 1, 2) g), '[]'::jsonb),
    'gerado_em', now());
end;
$$;

revoke execute on function public.funil_publico(integer) from public, anon;
grant  execute on function public.funil_publico(integer) to authenticated, service_role;
