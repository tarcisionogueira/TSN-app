-- Cadastro: gravar a VERSÃO de termos que a pessoa acabou de aceitar (14/08).
--
-- RELATADO PELO DONO acompanhando um cadastro ao vivo: "ao concluir a conta apareceram os
-- termos repetidamente; poderia juntar isso nos termos iniciais da tela de cadastro."
--
-- E é exatamente o que acontecia. A tela de cadastro TEM o aceite — checkbox obrigatório,
-- "Li e aceito os Termos de Uso e a Política de Privacidade", sem o qual o botão nem habilita
-- (`src/pages/Login.jsx`). O que ela mandava para o metadata era só `lgpd_aceito` e `lgpd_data`.
-- A `termos_uso_versao` do perfil ficava NULA — e o `TermosAtualizadosModal` dispara quando
-- `perfis.termos_uso_versao <> VERSAO_VIGENTE`. Resultado: a pessoa aceita os termos no
-- formulário e, um segundo depois, a plataforma pede que aceite os termos de novo. Do lado de
-- quem está criando a conta parece que o primeiro aceite não valeu.
--
-- A correção tem duas metades e as duas são necessárias:
--   1. AQUI: o trigger passa a copiar `termos_uso_versao`/`termos_uso_aceito_em` do metadata,
--      do mesmo jeito que já copia `lgpd_aceito`. Sem isto o front não tem onde gravar — no
--      cadastro com confirmação de e-mail ainda não existe sessão para dar UPDATE em `perfis`.
--   2. Em `src/pages/Login.jsx`: o signUp passa a enviar a versão vigente no metadata.
--
-- Aceite ANTIGO continua valendo como antes: quem não mandar a chave entra com NULL e o modal
-- aparece — que é o comportamento correto para quem de fato ainda não aceitou a versão atual.
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

  insert into public.perfis (id, nome, telefone, endereco, role, lgpd_aceito, lgpd_data, indicado_por,
                             termos_uso_versao, termos_uso_aceito_em)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    v_role,
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz,
    up_id,
    -- Só grava se o cliente declarou a versão. Quem não declarar segue com NULL e o modal
    -- aparece — comportamento certo para quem realmente não aceitou a versão vigente.
    nullif(trim(new.raw_user_meta_data->>'termos_uso_versao'), ''),
    case when nullif(trim(new.raw_user_meta_data->>'termos_uso_versao'), '') is not null
         then coalesce((new.raw_user_meta_data->>'lgpd_data')::timestamptz, now()) end
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
