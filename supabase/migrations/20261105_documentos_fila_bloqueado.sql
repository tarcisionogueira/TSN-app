-- 05/11 — BLOQUEADO NÃO É "SEM DOCUMENTO" (captura de documentos).
-- O capturador varria a página de desafio do Cloudflare ("Just a moment..."), achava 0 links e arquivava o lote
-- como `sem_documento` (terminal). Com a sub-cota diária do Bright Data esgotada, o caminho pago nem entrava.
-- Resultado: centenas de lotes com edital/matrícula em PDF no anexo marcados "sem documento" para sempre
-- (GF 116, Bolsa 54, Destak 46, Superbid 20…). Agora o script grava `bloqueado` e esta fila o retenta.

-- (1) A fila retenta `bloqueado` depois de 1 dia, por último (prioridade 4) e no máximo 15 por chamada —
--     cada um custa ~20 s de navegador, e sem teto eles tomariam a rodada de quem tem chance de sair.
create or replace function public.documentos_fila_proxima(p_limite integer default 40)
 returns table(imovel_id uuid, tentativas integer, prioridade integer)
 language sql stable security definer set search_path to 'public'
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

-- (2) Requalificação: `sem_documento` em lote ATIVO que tem edital/matrícula em arquivo no anexo é prova de que
--     o "sem documento" foi bloqueio, não medição. Volta como `bloqueado` (retentável). Idempotente.
create or replace function public.documentos_fila_requalificar_bloqueados()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n integer;
begin
  update public.documentos_fila f
     set status = 'bloqueado',
         erro = 'requalificado 05/11: anexo tem edital/matrícula, o "sem documento" foi bloqueio da fonte'
    from public.imoveis_leilao i
   where i.id = f.imovel_id and f.status = 'sem_documento' and i.ativo
     and exists (select 1 from jsonb_array_elements(coalesce(to_jsonb(i.anexos), '[]'::jsonb)) a
                  where a->>'tipo' in ('edital', 'matricula') and a->>'url' ~* '\.(pdf|docx?)($|\?)');
  get diagnostics n = row_count;
  return n;
end;
$function$;
revoke all on function public.documentos_fila_requalificar_bloqueados() from public, anon, authenticated;
