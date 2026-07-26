-- Faz o controle "Planos com acesso grátis" (planos_gratis, definido pelo admin no
-- cadastro do produto) REALMENTE valer para ebooks. Antes o obter_arquivo_ebook só
-- liberava por preço=0, compra avulsa ou papel padrão — ignorava o planos_gratis,
-- então marcar "Explorador (grátis)" num ebook pago não dava acesso nenhum.
create or replace function public.obter_arquivo_ebook(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url text; v_preco numeric; v_role text; v_gratis text[];
begin
  select arquivo_url, preco, coalesce(planos_gratis, '{}')
    into v_url, v_preco, v_gratis
    from ebooks_admin where id = p_id and ativo;
  if v_url is null then return null; end if;
  if coalesce(v_preco, 0) = 0 then return v_url; end if;           -- gratuito p/ todos
  if auth.uid() is null then return null; end if;                  -- pago exige login
  if exists (select 1 from compras_produtos
             where user_id = auth.uid() and produto_tipo = 'ebook'
               and produto_id = p_id and status = 'ativo') then return v_url; end if; -- comprou
  select coalesce(role, 'explorador') into v_role from perfis where id = auth.uid();
  v_role := coalesce(v_role, 'explorador');
  -- Papéis com acesso incluso por padrão (planos pagos + equipe)
  if v_role in ('top2','assessorado','clube','consultor','analista','advogado','admin') then return v_url; end if;
  -- Acesso GRÁTIS definido pelo admin no cadastro do produto (chips "Planos com acesso grátis")
  if v_role = any(v_gratis) then return v_url; end if;
  -- "Investidor Pro (anual)" no seletor mapeia para o mesmo papel top2
  if v_role = 'top2' and 'top2_anual' = any(v_gratis) then return v_url; end if;
  return null;
end;
$function$;
