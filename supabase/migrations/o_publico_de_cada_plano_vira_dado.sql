-- 01/09 — QUEM É CADA PESSOA PARA NÓS VIRA DADO, e sai da lista chumbada no código.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ACHADO QUE MOTIVOU (feedback do dono: "as respostas não iniciam automaticamente para cada
-- tipo de usuário com a sua classificação do role"). Três defeitos empilhados, e nenhum dá erro:
--
--   1. `whatsapp_fila_live` classifica como pagante SEIS roles:
--         top2 · top2_anual · assessorado · assessorado_anual · clube · clube_anual
--      Mas o CHECK de `perfis.role` só admite NOVE valores, e três daqueles NÃO estão nele:
--         admin · explorador · top1 · top2 · assessorado · clube · consultor · analista · advogado
--      `top2_anual`, `assessorado_anual` e `clube_anual` **nunca poderão existir** — o banco
--      recusaria o insert. São três testes que leem como cobertura e não cobrem nada. Ninguém
--      erra por causa deles hoje; erra-se ao LER a regra e acreditar que o anual está tratado.
--
--   2. `top1` está no CHECK e não está em lugar nenhum da regra. Cai no ramo de não-pagante.
--
--   3. E o que de fato chega ao cliente: `consultor`, `analista` e `advogado` **não são
--      excluídos da fila** (só `admin` é) e recebem a mensagem de quem se cadastrou e nunca
--      rodou uma análise. Para um Advogado Parceiro, isso não é só impreciso: é errado sobre
--      a relação que ele tem com a empresa — e a mensagem inteira existe para provar o oposto.
--
-- A CORREÇÃO NÃO É AUMENTAR A LISTA NO CÓDIGO. Foi assim que a lista ganhou três valores
-- impossíveis: lista chumbada não é conferida contra nada. O público passa a sair de
-- `planos_config`, que é onde os planos já vivem — plano novo entra classificado, e plano sem
-- classificação cai no NEUTRO explicitamente, em vez de ser agrupado no palpite mais próximo.

alter table public.planos_config
  add column if not exists publico    text,
  add column if not exists tratamento text;

-- `check` com `is null` permitido de propósito: plano novo nasce sem classificação e a
-- mensagem trata isso como "não sei quem é esta pessoa" — que é a resposta correta. Forçar um
-- valor obrigaria a chutar no cadastro, e o chute viraria uma frase afirmativa sobre a conta
-- de alguém, que é exatamente o defeito que este arquivo veio consertar.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'planos_config_publico_ck') then
    alter table public.planos_config
      add constraint planos_config_publico_ck
      check (publico is null or publico in ('cliente', 'parceiro', 'equipe', 'gratuito'));
  end if;
end $$;

comment on column public.planos_config.publico is
  'Que RELAÇÃO esta pessoa tem com a empresa: cliente (paga) · parceiro (traz ou atende '
  'cliente) · equipe (interno) · gratuito (usa e não paga). Governa o tom de toda comunicação '
  'de convite. NULO = não classificado, e a mensagem então não afirma relação nenhuma.';

comment on column public.planos_config.tratamento is
  'Como chamar quem tem este plano, EM MINÚSCULA e pronto para entrar em "Como você é ___" '
  '(ex.: "assinante do Investidor Pro"). É dado e não literal no código porque foi uma frase '
  'chumbada que disse a um assessorado, em produção, que ele era assinante do Investidor Pro.';

update public.planos_config set publico = 'cliente',  tratamento = 'assinante do Investidor Pro' where plano_key = 'top2';
update public.planos_config set publico = 'cliente',  tratamento = 'cliente da assessoria'       where plano_key = 'assessorado';
update public.planos_config set publico = 'cliente',  tratamento = 'membro do Leilão Club'       where plano_key = 'clube';
update public.planos_config set publico = 'parceiro', tratamento = 'consultor parceiro'          where plano_key = 'consultor';
update public.planos_config set publico = 'parceiro', tratamento = 'advogado parceiro'           where plano_key = 'advogado';
update public.planos_config set publico = 'equipe',   tratamento = 'do time'                     where plano_key = 'analista';
-- Explorador NÃO ganha tratamento: "Como você é explorador" nomeia a pessoa pelo plano
-- gratuito dela na primeira linha de um convite. O ramo do gratuito fala do que ela FEZ
-- (criou a conta, ainda não rodou análise), que é sobre ela e não sobre o que ela não pagou.
update public.planos_config set publico = 'gratuito', tratamento = null where plano_key = 'explorador';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- A fila passa a ler o público do PLANO, e não de uma lista de roles escrita à mão
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `left join`: role sem plano correspondente (hoje, `top1`) devolve publico NULO e cai na
-- faixa de quem não é cliente — sem afirmar nada sobre ele. Um `join` normal o faria SUMIR da
-- fila, que é a falha nº 1 desta base: ausência entregue como resposta.
-- `drop` antes do `create`: a função ganhou duas colunas de retorno, e o Postgres recusa
-- `create or replace` que muda o tipo de retorno. O `grant` no fim é o que reconstrói a
-- permissão que o drop levou junto — sem ele o endpoint passaria a receber 403 do PostgREST.
drop function if exists public.whatsapp_fila_live(uuid, date);

create or replace function public.whatsapp_fila_live(p_evento uuid, p_edicao date)
returns table (
  user_id uuid, nome text, cidade text, uf text, role text,
  telefone_wa text, prioridade int, motivo text,
  publico text, tratamento text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id, p.nome, p.endereco_cidade as cidade, p.endereco_uf as uf, p.role, p.created_at,
           regexp_replace(p.telefone, '\D', '', 'g') as dig,
           pc.publico, pc.tratamento,
           exists(select 1 from public.emails_log l
                   where l.user_id = p.id
                     and l.tipo in ('convite_live','live_reforco_assunto','live_reforco_prova')
                     and l.aberto_em is not null) as abriu
      from public.perfis p
      left join public.planos_config pc on pc.plano_key = p.role
     where p.ativo
       and coalesce(p.role,'') <> 'admin'
       and p.telefone is not null
       and not exists (select 1 from public.live_inscricoes i
                        where i.evento_id = p_evento and i.user_id = p.id)
       and not exists (select 1 from public.alertas_email a
                        where a.user_id = p.id and a.ativo = false)
       and not exists (select 1 from public.whatsapp_disparo_log w
                        where w.evento_id = p_evento and w.edicao = p_edicao and w.user_id = p.id)
  )
  select b.id, b.nome, b.cidade, b.uf, b.role,
         case when length(b.dig) in (10, 11) then '55' || b.dig else b.dig end,
         -- Parceiro vem logo depois do cliente: ele não compra, mas TRAZ quem compra, e é a
         -- pessoa com maior chance de levar a aula adiante. Antes ele estava no fundo, junto
         -- de quem nunca abriu um e-mail.
         case b.publico when 'cliente' then 1 when 'parceiro' then 2 when 'equipe' then 4
                        else case when b.abriu then 3 else 5 end end,
         case b.publico when 'cliente' then 'cliente' when 'parceiro' then 'parceiro'
                        when 'equipe' then 'equipe'
                        else case when b.abriu then 'abriu o e-mail' else 'nao abriu o e-mail' end end,
         b.publico, b.tratamento
    from base b
   where length(b.dig) between 10 and 13
   order by 7, b.created_at desc;
$$;

revoke all on function public.whatsapp_fila_live(uuid, date) from public, anon, authenticated;
grant execute on function public.whatsapp_fila_live(uuid, date) to service_role;
