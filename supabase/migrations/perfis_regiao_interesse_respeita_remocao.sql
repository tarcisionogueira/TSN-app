-- Região de interesse: preencher quando NUNCA houve, nunca desfazer uma remoção (14/08).
--
-- Correção da migração `perfis_regiao_de_interesse_da_cidade`, do mesmo dia, achada ao conferir
-- se ela não criaria problema para OUTRO usuário (pedido do dono: "verifique para que qualquer
-- usuário ao acessar não tenha essas mesmas situações se repetindo").
--
-- O DEFEITO QUE EU IA PUBLICAR. A tela `/perfil` deixa a pessoa gerenciar a sua região: se ela
-- limpa o campo e salva, `Perfil.jsx` grava `cidades_interesse: []` — e ali isso é INTENCIONAL,
-- é a forma de remover. O trigger da versão anterior disparava em qualquer update e repunha a
-- cidade do endereço. Resultado: a pessoa apagava a região, salvava, e ela voltava. Eu teria
-- trocado o bug do dado apagado sem querer por um bug pior — o de não conseguir apagar de
-- propósito —, e esse ainda pareceria a plataforma ignorando o usuário.
--
-- A DIFERENÇA QUE O TRIGGER PRECISA ENXERGAR é entre "nunca teve" e "acabou de remover", e ela
-- só existe comparando OLD com NEW:
--   • INSERT              → preenche se vier vazio (conta nova, ninguém removeu nada);
--   • UPDATE, OLD vazio   → preenche (é o caso do João: o cadastro sabia a cidade e o interesse
--                           nunca foi preenchido, ou foi zerado por um passo opcional em branco);
--   • UPDATE, OLD com itens e NEW vazio → NÃO MEXE. Foi remoção deliberada, e remoção é ordem.
create or replace function public.perfis_preencher_regiao_interesse()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- Remoção explícita (tinha região, ficou sem) é ordem do usuário: sai sem tocar.
  if tg_op = 'UPDATE'
     and coalesce(jsonb_array_length(old.cidades_interesse), 0) > 0
     and coalesce(jsonb_array_length(new.cidades_interesse), 0) = 0 then
    return new;
  end if;

  if coalesce(btrim(new.endereco_cidade), '') <> ''
     and coalesce(btrim(new.endereco_uf), '') <> ''
     and coalesce(jsonb_array_length(new.cidades_interesse), 0) = 0 then
    new.cidades_interesse := jsonb_build_array(jsonb_build_object(
      'cidade', btrim(new.endereco_cidade),
      'uf', upper(btrim(new.endereco_uf)),
      'raio_km', 50));
  end if;
  return new;
end;
$function$;
