-- 01/09 — A FILA DEVOLVE `nunca_analisou`, QUE O JS JÁ LIA DESDE O PRIMEIRO DIA.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ O DEFEITO MAIS CARO DOS QUATRO DESTE DIA, e o único que atingiu quase todo mundo.
--
-- `api/admin-whatsapp-fila.js` monta a mensagem com `nuncaAnalisou: p.nunca_analisou === true`.
-- A função NUNCA devolveu essa coluna. `undefined === true` é `false` — sem erro, sem aviso,
-- sem 400: só o ramo genérico, sempre. A linha pessoal do explorador — *"Vi que você criou a
-- sua conta e ainda não chegou a rodar uma análise"* — **nunca apareceu em mensagem nenhuma**.
--
-- É a linha que o próprio arquivo documenta como sendo a que FAZ a mensagem funcionar ("o que
-- prova que não é disparo em massa"), com um comentário afirmando que ela vale para 73 das 76
-- pessoas. O comentário estava certo sobre o DADO e errado sobre o CÓDIGO: o número foi medido
-- uma vez, à mão, e nunca chegou à mensagem.
--
-- MEDIDO AGORA, na fila viva: **64 das 66 pessoas** têm `nunca_analisou = true`. Sessenta e
-- quatro convites saíram genéricos onde havia uma frase verdadeira e pessoal disponível.
--
-- POR QUE NENHUMA TRAVA PEGOU: `verificar:schema` confere TABELAS e COLUNAS DE DATA em
-- `.from('x')`; isto é uma chave lida do retorno de uma RPC, que nenhuma das travas inspeciona.
-- É a forma nº 7 numa variante nova — não é migração que faltou aplicar, é CONTRATO entre a
-- função e o cliente que nunca foi verificado por ninguém. Em JS, ler chave inexistente é
-- silêncio; em SQL seria erro. O acoplamento atravessa a fronteira onde o erro deixa de existir.

-- `drop` antes do `create`: mais uma coluna no retorno, e o Postgres recusa `create or
-- replace` que muda o tipo de retorno. O `grant` no fim reconstrói o que o drop levou junto.
drop function if exists public.whatsapp_fila_live(uuid, date);

create or replace function public.whatsapp_fila_live(p_evento uuid, p_edicao date)
returns table (
  user_id uuid, nome text, cidade text, uf text, role text,
  telefone_wa text, prioridade int, motivo text,
  publico text, tratamento text, nunca_analisou boolean
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
           -- As TRÊS tabelas de análise, e não só a mercadológica: quem rodou só o documental
           -- rodou uma análise, e dizer a ele que nunca rodou é a frase falsa que esta coluna
           -- existe para evitar. `not exists` em vez de `count`: só interessa se houve alguma.
           not (exists (select 1 from public.analises_mercado    a where a.user_id = p.id)
             or exists (select 1 from public.analises_documental a where a.user_id = p.id)
             or exists (select 1 from public.analises_laudo      a where a.user_id = p.id)) as nunca,
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
         case b.publico when 'cliente' then 1 when 'parceiro' then 2 when 'equipe' then 4
                        else case when b.abriu then 3 else 5 end end,
         case b.publico when 'cliente' then 'cliente' when 'parceiro' then 'parceiro'
                        when 'equipe' then 'equipe'
                        else case when b.abriu then 'abriu o e-mail' else 'nao abriu o e-mail' end end,
         b.publico, b.tratamento, b.nunca
    from base b
   where length(b.dig) between 10 and 13
   order by 7, b.created_at desc;
$$;

comment on function public.whatsapp_fila_live(uuid, date) is
  'Fila do convite por WhatsApp. `nunca_analisou` foi ACRESCENTADA em 01/09: o JS já a lia '
  'desde o primeiro dia (`p.nunca_analisou === true`) e a função nunca a devolvia — '
  '`undefined === true` é false, então a linha pessoal do explorador nunca apareceu em '
  'mensagem nenhuma. Não dava erro: dava a mensagem genérica, que é plausível.';

revoke all on function public.whatsapp_fila_live(uuid, date) from public, anon, authenticated;
grant execute on function public.whatsapp_fila_live(uuid, date) to service_role;
