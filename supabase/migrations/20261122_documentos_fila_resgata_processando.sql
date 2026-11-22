-- 22/11: lote largado em 'processando' volta à fila.
-- Quando o GitHub cancela a rodada do captura-documentos no teto de tempo, o processo morre sem
-- fechar o lote da vez, e nada mais o pegava: 8 presos, o mais velho desde 26/10. Agora o script marca
-- processado_em ao PEGAR o lote; passada 1 h (a rodada tem teto de 55 min), ele conta como erro
-- transitório e volta enquanto tiver tentativas (< 4), na mesma faixa de prioridade de antes.
create or replace function public.documentos_fila_proxima(p_limite integer default 40)
 returns table(imovel_id uuid, tentativas integer, prioridade integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  (select f.imovel_id,
         coalesce(f.tentativas, 0) as tentativas,
         case
           when f.solicitado_em > now() - interval '3 days' then 0
           when i.ativo and i.data_leilao is null then 1
           when i.ativo                           then 2
           else 3
         end as prioridade
    from public.documentos_fila f
    join public.imoveis_leilao i on i.id = f.imovel_id
   where f.status = 'pendente'
      or (f.status = 'erro' and coalesce(f.tentativas, 0) < 4)
      or (f.status = 'processando' and coalesce(f.tentativas, 0) < 4
          and coalesce(f.processado_em, f.criado_em) < now() - interval '1 hour')
   order by 3, f.solicitado_em desc nulls last, f.criado_em
   limit greatest(1, least(coalesce(p_limite, 40), 500)))
  union all
  (select f.imovel_id, coalesce(f.tentativas, 0), 4
    from public.documentos_fila f
    join public.imoveis_leilao i on i.id = f.imovel_id
   where f.status = 'bloqueado' and i.ativo
     and coalesce(f.processado_em, f.criado_em) < now() - interval '1 day'
   order by f.processado_em nulls first
   limit 15);
$function$;
