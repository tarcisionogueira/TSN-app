-- Retenção de documentos (bucket `documentos`): acrescenta a regra do dono "MANTER
-- imóveis com RELATÓRIO gerado". ADITIVO — só adiciona condições de MANTER, nunca amplia
-- o que é apagado. Mantém a lógica existente:
--   • arrematado = true            → nunca apaga (permanente)
--   • imóvel ATIVO no acervo        → mantém (cobre venda direta e data futura)
--   • imóvel saiu do acervo (ativo=false) sem reunião → apaga
--   • com reunião                   → mantém 30 dias após o leilão
--   • sem vínculo com imóvel        → apaga 5 dias após criado
-- Agora, ADICIONALMENTE: se o imóvel tem QUALQUER análise (mercado/documental/laudo),
-- os documentos NÃO entram na fila de expiração. Aplicada via MCP; auditoria 0/0.
create or replace function public.anexos_expirados(p_limite integer default 100)
returns table(id uuid, storage_path text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    -- MANTER se o imóvel tem QUALQUER relatório gerado (regra do dono).
    and not exists (select 1 from public.analises_mercado   m where m.imovel_id::text = a.imovel_id::text)
    and not exists (select 1 from public.analises_documental d where d.imovel_id::text = a.imovel_id::text)
    and not exists (select 1 from public.analises_laudo      l where l.imovel_id::text = a.imovel_id::text)
    and case
      when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id) then
        exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and coalesce(i.ativo, true) = false)
        and (
          not exists (
            select 1 from public.reunioes r
            join public.casos c on c.id = r.caso_id
            where c.imovel_id = a.imovel_id::text
              and (r.status in ('realizada','concluida') or r.realizado_em is not null))
          or coalesce(a.data_leilao, (current_date - 31)) <= (current_date - 30)
        )
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;
