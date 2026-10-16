-- Irmão de estado_fora_do_padrao para VEÍCULOS (16/10, pendência 226): UF que não existe ("LO", "CG"
-- do título MARCA/MODELO no SUPORTE; "SI" do caminho da URL na MEGA) passava calada — o lote some do
-- filtro por estado e ninguém via. Limite 0: UF inválida é sempre defeito do coletor.
do $$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
declare velho text := $v$(select count(*) from veiculos_leilao where ativo and local_ibge = false), 30),$v$;
declare novo text := $v$(select count(*) from veiculos_leilao where ativo and local_ibge = false), 30),
     ('veiculo_uf_invalida','Captura: veículo ativo com UF que não existe (título MARCA/MODELO lido como Cidade/UF, sigla de "sem informação") — some do filtro por estado','Captura','bug',
       (select count(*) from veiculos_leilao where ativo and estado is not null
          and estado !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'), 0),$v$;
begin
  if position(velho in d) = 0 then raise exception 'trecho de veiculo_cidade_fora_do_ibge não encontrado'; end if;
  if position('veiculo_uf_invalida' in d) > 0 then return; end if;
  execute replace(d, velho, novo);
end $$;

-- estado_fora_do_padrao voltou a 1 (16/10): SUPORTE sandrasantos 4082, entrou hoje. O lote diz só
-- "Rua Melo Figueiredo nº 147, lote 22, Quadra 36" — sem cidade. Explicado, como os 14 de antes.
insert into public.qa_invariante_explicada (chave, imovel_id, explicacao, explicado_ate)
select 'estado_fora_do_padrao', '36f89131-fe7e-47fc-b7bc-d810aee616e0'::uuid,
       'SUPORTE (sandrasantos 4082): lote só traz rua/lote/quadra, sem cidade — não inventar.', current_date + 30
 where exists (select 1 from public.imoveis_leilao where id = '36f89131-fe7e-47fc-b7bc-d810aee616e0')
on conflict do nothing;
