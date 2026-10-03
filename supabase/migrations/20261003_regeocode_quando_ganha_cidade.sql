-- 03/10 — lote que GANHA cidade/UF depois de ter falhado no geocode volta sozinho para a fila.
--
-- Por quê: o geocodificador (api/geocodificar.js) só pega `latitude is null`, `lat=0 and geocod_nivel
-- is null` ou `geocod_nivel='refazer'`. Lote que entrou sem cidade vira 'falhou' (lat 0, fora do mapa —
-- correto, ver api/_geo.js: sem cidade e sem UF não se chuta pino). Quando a cidade chega depois
-- (ALBERTOMACEDO: itens de pacote passaram a ter cidade pela API do site em 03/10), nada o devolvia à
-- fila: o lote ficaria fora do mapa PARA SEMPRE com a localização certa no banco. Mesmo padrão que este
-- trigger já usava para endereço derivado do título. Vale para qualquer fonte.
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

-- Uma vez (03/10): os itens ALBERTOMACEDO que ganharam cidade na coleta de 03/10 23:22 UTC, antes
-- deste trigger existir. Idempotente (só pega 'falhou' com cidade e UF válidas).
update imoveis_leilao set geocod_nivel = 'refazer'
 where ativo and fonte = 'ALBERTOMACEDOLEILOES' and url_lote like '%/lote/%'
   and geocod_nivel = 'falhou' and coalesce(btrim(cidade),'') <> '' and coalesce(estado,'') ~ '^[A-Z]{2}$';
