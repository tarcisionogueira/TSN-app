-- Retenção da caixa de e-mail: piso de 24 MESES (decisão do dono, 30/09).
-- Os três prazos curtos sobem para 24 meses — avulso (era 90 d), negociação sem resposta (180 d) e
-- negociação sem acordo (1 ano). Ficam como estavam: spam 30 d; operação concluída e jurídico
-- 10 anos (CC arts. 1.194/205, Lei 9.613 art. 10 — prazo legal, não pode baixar); caso aberto e
-- retenção manual sem prazo. A regra muda de nome para a tela não mostrar o prazo antigo.
create or replace function public._email_caixa_prazos()
 returns table(id uuid, regra text, guardar_ate timestamp with time zone)
 language sql stable security definer set search_path to 'public'
as $function$
  with conv as (
    select c.conversa_chave as k,
           max(c.criado_em) as ultima,
           bool_or(c.reter) as retida,
           bool_or(c.categoria = 'juridico') as juridica,
           bool_or(c.direcao = 'entrada' and c.categoria <> 'spam') as respondida,
           bool_or(c.categoria not in ('spam','avulso')) as operacional,
           bool_or(c.caso_id is not null) as tem_caso,
           bool_or(c.caso_id is not null and cs.concluido_em is null) as caso_aberto,
           max(cs.concluido_em) as concluido
      from public.email_caixa c left join public.casos cs on cs.id = c.caso_id
     group by 1
  )
  select c.id,
    case when k.retida then 'retencao_manual'
         when k.tem_caso and k.caso_aberto then 'operacao_em_andamento'
         when k.tem_caso then 'operacao_concluida_10a'
         when k.juridica then 'juridico_10a'
         when c.categoria = 'spam' then 'spam_30d'
         when not coalesce(k.operacional, false) then 'avulso_24m'
         when not k.respondida then 'sem_resposta_24m'
         else 'com_resposta_24m' end,
    case when k.retida or (k.tem_caso and k.caso_aberto) then null
         when k.tem_caso then greatest(k.concluido, k.ultima) + interval '10 years'
         when k.juridica then k.ultima + interval '10 years'
         when c.categoria = 'spam' then c.criado_em + interval '30 days'
         else k.ultima + interval '24 months' end
    from public.email_caixa c join conv k on k.k = c.conversa_chave
$function$;
