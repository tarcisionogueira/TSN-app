-- Entitlement server-side p/ o arquivo do ebook (auditoria id=9, achado 34).
--
-- Problema: a policy "Leitura publica ebooks" (SELECT qual=true p/ public) deixava
-- qualquer anônimo ler arquivo_url do ebook PAGO (hoje um link do Drive).
--
-- Correção: arquivo_url passa a sair SÓ pela RPC de entitlement (grátis OR plano
-- pago OR compra avulsa ativa); EbookPage.jsx/Membros.jsx deixam de selecionar a
-- coluna e a coluna é revogada do anon. (Fecha a enumeração anônima; a proteção
-- completa do arquivo exige o dono mover o PDF p/ Storage privado — a RPC já está
-- pronta p/ devolver signed URL quando isso acontecer.)
--
-- ORDEM EM PRODUÇÃO: (1) criar a RPC; (2) subir EbookPage/Membros que usam a RPC e
-- não selecionam arquivo_url; (3) só então revogar a coluna do anon.

create or replace function public.obter_arquivo_ebook(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url text; v_preco numeric; v_role text;
begin
  select arquivo_url, preco into v_url, v_preco from ebooks_admin where id = p_id and ativo;
  if v_url is null then return null; end if;
  if coalesce(v_preco, 0) = 0 then return v_url; end if;          -- gratuito
  if auth.uid() is null then return null; end if;                  -- pago exige login
  if exists (select 1 from compras_produtos
             where user_id = auth.uid() and produto_tipo = 'ebook'
               and produto_id = p_id and status = 'ativo') then return v_url; end if; -- comprou
  select role into v_role from perfis where id = auth.uid();
  if v_role in ('top2','assessorado','clube','consultor','analista','advogado','admin') then return v_url; end if; -- plano
  return null;
end;
$function$;

revoke all on function public.obter_arquivo_ebook(uuid) from public;
grant execute on function public.obter_arquivo_ebook(uuid) to anon, authenticated;

-- Passo 3 (aplicar após o deploy de EbookPage/Membros): fecha a leitura anônima da
-- coluna do arquivo. Mantém acesso a authenticated (admin gerencia via select *).
revoke select (arquivo_url) on public.ebooks_admin from anon;
