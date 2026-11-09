-- 08/11 (dono): link avulso é feito para uma pessoa e é de uso único. Pagou: dá baixa, ativa o produto e encerra o resto.
-- Revoga a decisão de 07/11 ("pagar a cobrança avulsa não ativa plano sozinho").
alter table public.cobrancas_avulsas add column if not exists produto_ativado_em timestamptz;
alter table public.cobrancas_avulsas add column if not exists efeitos_em timestamptz;
alter table public.cobrancas_avulsas add column if not exists efeitos_tentativas integer not null default 0;
alter table public.cobrancas_avulsas add column if not exists efeitos_erro text;
alter table public.cobrancas_avulsas add column if not exists efeitos_resultado jsonb;

-- Criado antes de o link registrar o produto: a descrição é "Assessoria BidPro — 2 imóveis". O cron aplica em até 1 minuto.
update public.cobrancas_avulsas
   set produto_key = 'assessorado_negociada'
 where id = 'c40d33c8-b6d0-4884-9f2e-b99c1ae784e7' and produto_key is null;

-- Vigia: pago há mais de 1 hora sem ativar ou sem encerrar as pendências, com o motivo por extenso.
create or replace function public.pagamentos_sem_baixa()
returns table(tipo text, referencia text, valor numeric, desde timestamptz, detalhe text)
language sql stable security definer set search_path = public as $f$
  select 'aviso_nao_processado', m.mp_payment_id, m.valor, m.criado_em,
         coalesce(m.dados_mp->'metadata'->>'tipo', m.origem)
    from mp_pagamentos m
   where m.status = 'approved'
     and m.criado_em > now() - interval '60 days' and m.criado_em < now() - interval '1 hour'
     and (m.origem <> 'terceiro' or m.dados_mp->>'notification_url' ilike '%bidprobrasil%')
     and not exists (select 1 from webhook_eventos_processados e
                      where e.gateway = 'mercadopago' and e.gateway_payment_id = m.mp_payment_id)
  union all
  select 'cobranca_aberta', c.id::text, m.valor, m.criado_em, left(c.descricao, 90)
    from mp_pagamentos m
    join cobrancas_avulsas c
      on c.id::text = coalesce(m.dados_mp->'metadata'->>'cobranca_id', substring(m.external_ref from 'cobranca:(.+)'))
   where m.status = 'approved' and c.status = 'aberta'
  union all
  select 'pagou_falta_ativar', c.id::text, c.valor, c.pago_em, left(c.descricao, 90)
    from cobrancas_avulsas c
   where c.status = 'paga'
     and (c.descricao ilike '%assessoria%' or c.termo_titulo ilike '%assessoria%')
     and not exists (
       select 1 from perfis p
        where p.role like 'assessorado%'
          and (p.id::text = (select m.user_id::text from mp_pagamentos m where m.mp_payment_id = c.gateway_payment_id)
               or p.id in (select u.id from auth.users u where lower(u.email) = lower(c.destinatario_email))))
  union all
  select 'efeitos_pendentes', c.id::text, c.valor, c.pago_em,
         left(c.descricao, 60) || ' — ' || coalesce(left(c.efeitos_erro, 140), 'aguardando o cron')
    from cobrancas_avulsas c
   where c.status = 'paga' and c.efeitos_em is null and c.pago_em < now() - interval '1 hour';
$f$;
