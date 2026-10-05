-- O lote que um CLIENTE está esperando (gerou relatório e faltou documento) furava a fila? Não:
-- entrava atrás de ~1.400 pendentes do enriquecimento em massa, e a tela prometia "cerca de 1
-- minuto". `solicitado_em` é gravado pelos geradores de relatório; até 3 dias depois, prioridade 0.
alter table public.documentos_fila add column if not exists solicitado_em timestamptz;

create or replace function public.documentos_fila_proxima(p_limite integer default 40)
 returns table(imovel_id uuid, tentativas integer, prioridade integer)
 language sql stable security definer set search_path to 'public'
as $function$
  select f.imovel_id,
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
   order by 3, f.solicitado_em desc nulls last, f.criado_em
   limit greatest(1, least(coalesce(p_limite, 40), 500));
$function$;
