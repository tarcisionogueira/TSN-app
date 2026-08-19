-- 19/08 — a cidade OBRIGATÓRIA do cadastro não chegava a `endereco_cidade`/`endereco_uf`:
-- o Login manda `endereco: "Cidade - UF"` (datalist) e o trigger gravava só o texto livre.
-- Resultado: TODO cadastro por e-mail caía no modal bloqueante "Qual a sua cidade?" no
-- primeiro login (pedindo o que a pessoa acabou de digitar — o mesmo defeito dos termos,
-- 14/08), e os alertas por e-mail (`enviar-alertas-cron` lê `endereco_cidade`) saíam sem a
-- região prometida na tela. O parser espelha o fallback já usado em Busca.jsx:702.
-- Quem digitou cidade sem UF fica só com `endereco_cidade` — o modal ainda pede a UF, que
-- é o comportamento certo para dado realmente incompleto.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  up_id  uuid;
  ref_raw text;
  v_role text;
  v_end text;
  v_cidade text;
  v_uf text;
begin
  ref_raw := nullif(trim(new.raw_user_meta_data->>'ref_codigo'), '');
  if ref_raw is not null then
    begin
      up_id := ref_raw::uuid;
      if not exists (select 1 from public.perfis where id = up_id) then up_id := null; end if;
    exception when others then up_id := null; end;
    if up_id is null then
      select id into up_id from public.perfis where codigo_indicacao = upper(ref_raw) limit 1;
    end if;
    if up_id = new.id then up_id := null; end if;
  end if;

  v_role := coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'explorador');
  if not (v_role = any (array['explorador'])) then
    v_role := 'explorador';
  end if;

  -- Cidade estruturada a partir do texto do cadastro ("Cidade - UF", "Cidade/UF" ou só cidade)
  v_end := nullif(trim(new.raw_user_meta_data->>'endereco'), '');
  if v_end is not null then
    if v_end ~ '^\s*.+\s*[-–/]\s*[A-Za-z]{2}\s*$' then
      v_cidade := trim(regexp_replace(v_end, '\s*[-–/]\s*[A-Za-z]{2}\s*$', ''));
      v_uf     := upper(right(trim(v_end), 2));
    else
      v_cidade := v_end;  -- sem UF: o modal de completar cadastro ainda pergunta
      v_uf     := null;
    end if;
  end if;

  insert into public.perfis (id, nome, telefone, endereco, role, lgpd_aceito, lgpd_data, indicado_por,
                             termos_uso_versao, termos_uso_aceito_em,
                             endereco_cidade, endereco_uf, cidades_interesse)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    v_role,
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz,
    up_id,
    nullif(trim(new.raw_user_meta_data->>'termos_uso_versao'), ''),
    case when nullif(trim(new.raw_user_meta_data->>'termos_uso_versao'), '') is not null
         then coalesce((new.raw_user_meta_data->>'lgpd_data')::timestamptz, now()) end,
    v_cidade,
    v_uf,
    case when v_cidade is not null and v_uf is not null
         then jsonb_build_array(jsonb_build_object('cidade', v_cidade, 'uf', v_uf, 'raio_km', 50))
         end
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- Backfill dos cadastros existentes que ficaram só com o texto livre (mesmo parser; não
-- toca quem já tem os campos estruturados).
update public.perfis
   set endereco_cidade = trim(regexp_replace(endereco, '\s*[-–/]\s*[A-Za-z]{2}\s*$', '')),
       endereco_uf     = upper(right(trim(endereco), 2)),
       cidades_interesse = coalesce(cidades_interesse,
         jsonb_build_array(jsonb_build_object(
           'cidade', trim(regexp_replace(endereco, '\s*[-–/]\s*[A-Za-z]{2}\s*$', '')),
           'uf', upper(right(trim(endereco), 2)), 'raio_km', 50)))
 where coalesce(endereco_cidade,'') = '' and coalesce(endereco_uf,'') = ''
   and endereco ~ '^\s*.+\s*[-–/]\s*[A-Za-z]{2}\s*$'
   -- só o formato "Cidade - UF" puro: com dígito/vírgula é endereço completo legado, e
   -- extrair "cidade" de rua+número gravaria região errada (medido antes de aplicar: 1 linha).
   and endereco !~ '[0-9,]' and length(endereco) < 60;
