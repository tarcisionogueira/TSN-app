-- 22/09: nova ferramenta da IA administrativa (verificar_arremate_processo, em
-- api/_admin-chat-tools.js) precisa achar lote por numero_processo, mas a coluna tem os DOIS
-- formatos no mesmo campo: 596 linhas só dígitos, 21 linhas com pontuação CNJ
-- ("5006360-95.2023.8.08.0021"). Um filtro `numero_processo=eq.X` do PostgREST perderia
-- silenciosamente essas 21 sempre que o número de entrada vier no formato diferente do
-- gravado — mesma família de "campo certo, comparação errada" que este projeto já filtra
-- (ver forma nº 6 do CLAUDE.md, sobre coluna errada). RPC normaliza os dois lados (só
-- dígitos) antes de comparar, então funciona com entrada em qualquer formato.
create or replace function public.buscar_lote_por_processo(p_numero text)
returns table (id uuid, titulo text, cidade text, estado text, fonte text, ativo boolean)
language sql
stable
set search_path to 'public'
as $function$
  select i.id, i.titulo, i.cidade, i.estado, i.fonte, i.ativo
    from imoveis_leilao i
   where regexp_replace(i.numero_processo, '\D', '', 'g') = regexp_replace(p_numero, '\D', '', 'g')
     and length(regexp_replace(p_numero, '\D', '', 'g')) >= 15
   limit 5;
$function$;

revoke all on function public.buscar_lote_por_processo(text) from public, anon, authenticated;
grant execute on function public.buscar_lote_por_processo(text) to service_role;
