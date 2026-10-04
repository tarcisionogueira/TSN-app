-- 04/10 — scrape que NÃO leu a cidade/UF não apaga a cidade/UF que o banco já sabe.
--
-- Por quê (invariante estado_fora_do_padrao, 12 lotes): vários parsers gravam `cidade = ''` /
-- `estado = ''` quando a página não traz o dado. Sem esta trava, qualquer cidade que chegou por outro
-- caminho — a API do ALBERTOMACEDO (03/10), uma correção manual, a derivação pelo IBGE — era apagada no
-- scrape seguinte, e consertar à mão virava retrabalho diário. Cidade não deixa de existir: vazio na
-- coleta é "não li", nunca "mudou". Mesmo padrão que este trigger já aplica a endereço e bairro.
-- A preservação vem ANTES do reenfileiramento de geocode (03/10): cidade preservada não conta como
-- "ganhou cidade".
create or replace function public.preservar_e_derivar_endereco()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v_novo text;
begin
  if tg_op <> 'INSERT' then
    if coalesce(btrim(new.endereco),'') = '' and coalesce(btrim(old.endereco),'') <> '' then
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
    -- Ganhou cidade ou UF válida agora: a coordenada atual (ou a falta dela) foi decidida sem isso.
    if ((coalesce(btrim(old.cidade),'') = '' and coalesce(btrim(new.cidade),'') <> '')
        or (coalesce(old.estado,'') !~ '^[A-Z]{2}$' and coalesce(new.estado,'') ~ '^[A-Z]{2}$'))
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
  end if;

  if coalesce(btrim(new.endereco),'') = '' then
    v_novo := public.endereco_do_titulo(new.titulo, new.cidade);
    if v_novo is not null then
      new.endereco := v_novo;
      -- Pede regeocode: a coordenada atual é fallback de cidade. Sem isto o endereço fica
      -- certo e o PONTO continua errado, que é metade do defeito.
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  return new;
end $function$;

-- Uma vez (04/10): o único dos 12 com localização inequívoca no próprio título
-- ("Condomínio Grand Panamby ¿ Vila Andrade/SP" — Vila Andrade/Panamby é bairro de São Paulo).
-- Os demais ficam sem cidade de propósito: inventar cidade é pior que não ter (ver HANDOFF 04/10).
update imoveis_leilao set cidade = 'São Paulo', estado = 'SP'
 where ativo and fonte = 'SUPERBID' and fonte_id = (select fonte_id from imoveis_leilao
   where ativo and fonte = 'SUPERBID' and coalesce(estado,'') = '' and titulo ilike '%Grand Panamby%Vila Andrade/SP%' limit 1);
