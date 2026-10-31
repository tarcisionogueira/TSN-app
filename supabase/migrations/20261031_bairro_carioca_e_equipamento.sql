-- 31/10 (continuação de 20261031_local_pela_uf_da_fonte.sql) — dos 169 que sobraram sem UF:
-- (1) leiloeiros da CAPITAL do RJ (BSP, Schulmann, Frederico, MK Lance, Alexandre Costa) escrevem só o BAIRRO:
--     "Barra Olímpica", "Freguesia de Jacarepaguá", "Estácio/RJ", "Pilares/RJ", "Copacabana". Bairro carioca
--     inconfundível → Rio de Janeiro/RJ quando (a) vem com "/RJ" logo depois, em qualquer fonte, ou (b) a fonte só
--     publica no RJ. Fora da lista o que é palavra comum ou nome de bairro de outra cidade fluminense (Centro, Penha,
--     Ramos, Olaria, Santa Cruz, Freguesia sozinha, Glória, Lapa, Anil, Urca, Leme, Caju…). Seco: 30 de 42.
-- (2) equipamento entrava como imóvel — o filtro de bem móvel só conhecia veículo: "1) Penhora e avaliação de piano",
--     "i) 1(uma) furadeira", "CALANDRA INDUSTRIAL", "1) 03 ar condicionados", "Forno Industrial", "PLACAS DE ENERGIA
--     FOTOVOLTAICAS", "Geladeira Comercial". Sinal só no COMEÇO do título (numeração "1)"/"i)" e quantidade permitidas);
--     no acervo inteiro pega 13 lotes, todos equipamento (7 ativos).
create or replace function public.bairro_carioca(p_titulo text, p_descricao text, p_ufs text[]) returns boolean
 language sql stable set search_path to 'public' as $$
  with t as (select ' ' || public.sem_acento(coalesce(p_titulo, '') || ' | ' || left(coalesce(p_descricao, ''), 3000)) || ' ' x),
  b as (select '(jacarepagua|barra da tijuca|barra olimpica|recreio dos bandeirantes|taquara|tijuca|copacabana|ipanema|leblon|botafogo|flamengo|laranjeiras|estacio|pilares|andarai|meier|bonsucesso|madureira|bangu|realengo|iraja|vila isabel|grajau|cachambi|engenho de dentro|del castilho|maracana|catete|humaita|gavea|sao conrado|vargem grande|vargem pequena|ilha do governador|guaratiba|pechincha|curicica|camorim|itanhanga|praca seca|cascadura|rio comprido|santa teresa|jardim botanico|vila da penha|marechal hermes|padre miguel|sepetiba|inhauma|lins de vasconcelos)' r)
  select x ~ ('[^a-z]' || r || '\s*(/|-|–|,)\s*rj[^a-z]')
      or (p_ufs = array['RJ'] and x ~ ('[^a-z]' || r || '[^a-z]'))
    from t, b
$$;

create or replace function public.equipamento_no_titulo(p_titulo text) returns boolean
 language sql immutable set search_path to 'public' as $$
  select lower(public.sem_acento(coalesce(p_titulo, ''))) ~
    '^\s*(\(?[0-9ivx]{1,3}\)\s*)?(\d{1,3}\s*(\([a-z]+\))?\s*)?(penhora e avaliacao de\s+)?(uma?\s+)?(piano|furadeira|calandra|ar[ -]?condicionad|forno industrial|placas? (de energia )?(solar|fotovoltaic)|compressor|gerador de energia|torno mecanico|freezer|geladeira|fogao industrial)'
$$;

create or replace function public.imovel_barrar_bem_movel()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.ativo and (public.bem_movel_barrado(new.titulo, new.descricao) or public.equipamento_no_titulo(new.titulo)) then
    new.ativo := false;
  end if;
  return new;
end;
$function$;

-- trigger de local: o bairro carioca entra DEPOIS do município solto (que acha "Rio de Janeiro" escrito por extenso)
do $$
declare d text; antes constant text := '      if f.uf is not null and (new.estado is null or new.estado = f.uf) then
        new.cidade := f.cidade; new.estado := f.uf;
      end if;';
begin
  d := pg_get_functiondef('public.trg_local_do_texto()'::regprocedure);
  if (length(d) - length(replace(d, antes, ''))) / length(antes) <> 1 then
    raise exception 'trecho do trg_local_do_texto não encontrado exatamente 1 vez';
  end if;
  d := replace(d, antes, antes || '
      if coalesce(new.cidade, '''') = '''' and (new.estado is null or new.estado = ''RJ'')
         and public.bairro_carioca(new.titulo, new.descricao, public.ufs_da_fonte(new.fonte)) then
        new.cidade := ''Rio de Janeiro''; new.estado := ''RJ'';
      end if;');
  execute d;
end $$;

-- dado já gravado (mesmo resultado que a próxima coleta daria): equipamento sai, bairro carioca ganha cidade
update public.imoveis_leilao set suprimido_motivo = 'nao_imovel', ativo = false
 where ativo and public.equipamento_no_titulo(titulo);
update public.imoveis_leilao set cidade = cidade
 where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$');
