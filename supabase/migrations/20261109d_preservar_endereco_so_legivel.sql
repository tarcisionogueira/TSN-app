-- 09/11: o gatilho preservava QUALQUER endereço antigo quando o novo vinha vazio — inclusive o corrompido
-- "aL [��, 5" (Teles & Lima 21554), que assim nunca podia ser limpo nem por migração nem por coletor corrigido.
-- Agora só preserva endereço LEGÍVEL (mesma régua de sanearLocalizacao em api/_geo.js e da tela do imóvel):
-- ≥ 6 caracteres, três letras seguidas e sem o caractere de substituição U+FFFD.
create or replace function public.preservar_e_derivar_endereco()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v_novo text; v_desc text[];
begin
  if tg_op = 'INSERT' and coalesce(btrim(new.endereco),'') = '' and new.fonte_id is not null and exists (
       select 1 from public.imoveis_leilao o
        where o.fonte_id = new.fonte_id and o.endereco ~ ',\s*\d{1,5}'
          and o.titulo is not distinct from new.titulo and o.descricao is not distinct from new.descricao) then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    if coalesce(btrim(new.endereco),'') = '' and coalesce(btrim(old.endereco),'') <> ''
       and length(btrim(old.endereco)) >= 6 and old.endereco ~* '[a-zà-ú]{3}' and position(chr(65533) in old.endereco) = 0 then
      new.endereco := old.endereco;
    end if;
    if coalesce(btrim(new.bairro),'') = '' and coalesce(btrim(old.bairro),'') <> '' then
      new.bairro := old.bairro;
    end if;
    if coalesce(btrim(new.cidade),'') = '' and coalesce(btrim(old.cidade),'') <> '' then
      new.cidade := old.cidade;
    end if;
    if coalesce(new.estado,'') !~ '^[A-Za-z]{2}$' and coalesce(old.estado,'') ~ '^[A-Za-z]{2}$' then
      new.estado := old.estado;
    end if;
    if ((coalesce(btrim(old.cidade),'') = '' and coalesce(btrim(new.cidade),'') <> '')
        or (coalesce(old.estado,'') !~ '^[A-Z]{2}$' and coalesce(new.estado,'') ~ '^[A-Z]{2}$'))
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
    if coalesce(new.endereco,'') ~ ',\s*\d{1,5}' and coalesce(old.endereco,'') is distinct from coalesce(new.endereco,'')
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'bairro', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
  end if;
  if coalesce(btrim(new.endereco),'') = '' then
    v_novo := public.endereco_do_titulo(new.titulo, new.cidade);
    if v_novo is not null then
      new.endereco := v_novo;
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  if coalesce(btrim(new.endereco),'') = '' then
    v_desc := public.endereco_da_descricao(new.descricao, new.cidade);
    if v_desc is not null then
      new.endereco := v_desc[1];
      if coalesce(btrim(new.bairro),'') = '' and coalesce(v_desc[2],'') <> '' then new.bairro := v_desc[2]; end if;
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'bairro', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  return new;
end $function$;

update imoveis_leilao set endereco = null
 where fonte = 'TELESELIMA' and position(chr(65533) in endereco) > 0;
