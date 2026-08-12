-- UMA CONVENÇÃO DE `cidade_norm`, e uma trava para não divergir de novo (12/08).
-- Aplicada em produção em 12/08.
--
-- O DANO MEDIDO, e ele chegava ao cliente: a mesma cidade estava gravada em DUAS grafias
-- dentro da MESMA tabela de amostras. O relatório consulta com a grafia de `imoveis_leilao`
-- (sem espaço) e não enxergava a outra metade:
--     Feira de Santana/BA   "feira de santana" 117 · "feiradesantana"    54  → via  54 de 171
--     Lauro de Freitas/BA   "lauro de freitas"  59 · "laurodefreitas"    20  → via  20 de  79
--     Santana de Parnaíba   "santana de parnaiba" 38 · "santanadeparnaiba" 45 → via 45 de  83
--     São Paulo/SP          "sao paulo"         28 · "saopaulo"          19  → via  19 de  47
-- Até 75% das amostras de mercado da própria cidade invisíveis para o relatório que deveria
-- usá-las. Não dá erro, não gera alerta — só produz um índice mais pobre.
--
-- ORIGEM: `norm()` em api/indice-*.js colapsa não-alfanuméricos em ESPAÇO e existe um
-- `cidadeNormDb = cidadeNorm.replace(/\s+/g,'')` logo abaixo — o código SABE das duas formas.
-- Parte dos caminhos usava uma, parte usava a outra (7 chamadas corrigidas no mesmo commit).
--
-- CANÔNICO = SEM ESPAÇO: é a convenção de `imoveis_leilao` (30.997) e `cidade_socio` (5.571),
-- as duas maiores e as duas 100% consistentes.

-- 1) Mescla as 6 colisões de `cidade_indicadores` (cidade_norm faz parte da PK): fica a linha
--    com MAIS amostras; empate, a mais recente. A descartada é a de menor base estatística.
delete from public.cidade_indicadores a
 using public.cidade_indicadores b
 where replace(a.cidade_norm,' ','') = replace(b.cidade_norm,' ','')
   and a.nivel = b.nivel and a.uf = b.uf and a.bairro_norm = b.bairro_norm
   and a.geo_grid = b.geo_grid and a.tipo = b.tipo
   and a.cidade_norm <> b.cidade_norm
   and (coalesce(a.n_amostras,0), a.atualizado_em) < (coalesce(b.n_amostras,0), b.atualizado_em);

update public.cidade_indicadores  set cidade_norm = replace(cidade_norm,' ','') where cidade_norm like '% %';
update public.indice_amostra      set cidade_norm = replace(cidade_norm,' ','') where cidade_norm like '% %';
update public.indice_amostras     set cidade_norm = replace(cidade_norm,' ','') where cidade_norm like '% %';
update public.fonte_local_cidade  set cidade_norm = replace(cidade_norm,' ','') where cidade_norm like '% %';

-- 2) TRAVA na escrita. Sem ela, o próximo caminho que use `norm()` sem tirar o espaço
--    reintroduz a divergência — e ela volta a ser invisível.
create or replace function public.trg_cidade_norm_sem_espaco()
returns trigger language plpgsql as $$
begin
  if new.cidade_norm is not null then new.cidade_norm := replace(new.cidade_norm, ' ', ''); end if;
  return new;
end $$;

drop trigger if exists cidade_norm_norm on public.cidade_indicadores;
create trigger cidade_norm_norm before insert or update on public.cidade_indicadores
  for each row execute function public.trg_cidade_norm_sem_espaco();
drop trigger if exists cidade_norm_norm on public.indice_amostra;
create trigger cidade_norm_norm before insert or update on public.indice_amostra
  for each row execute function public.trg_cidade_norm_sem_espaco();
drop trigger if exists cidade_norm_norm on public.indice_amostras;
create trigger cidade_norm_norm before insert or update on public.indice_amostras
  for each row execute function public.trg_cidade_norm_sem_espaco();
drop trigger if exists cidade_norm_norm on public.fonte_local_cidade;
create trigger cidade_norm_norm before insert or update on public.fonte_local_cidade
  for each row execute function public.trg_cidade_norm_sem_espaco();
