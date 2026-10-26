-- 26/10: endereço com número que CHEGA depois (coletor, descrição, enriquecimento) não reabria o geocode.
-- O lote de Feira de Santana (bb0c2247) ganhou "Rua Visconde do Rio Branco, 920" em 25/10 e ficou no pino do
-- bairro com 0 tentativas: o gatilho só marcava 'refazer' quando ELE derivava o endereço, e o
-- regeocod-imprecisos exclui nível 'bairro' com bairro preenchido. 544 ativos nesse estado (369 bairro, 175 cidade).
-- Agora: no UPDATE, endereço novo com número sobre nível cidade/bairro/falhou → 'refazer'.
do $$
declare d text := pg_get_functiondef('public.preservar_e_derivar_endereco()'::regprocedure); n text;
begin
  n := replace(d,
E'       and coalesce(new.geocod_nivel,\'\') in (\'\', \'cidade\', \'falhou\') then\n      new.geocod_nivel := \'refazer\';\n    end if;\n  end if;',
E'       and coalesce(new.geocod_nivel,\'\') in (\'\', \'cidade\', \'falhou\') then\n      new.geocod_nivel := \'refazer\';\n    end if;\n    if coalesce(new.endereco,\'\') ~ \',\\s*\\d{1,5}\' and coalesce(old.endereco,\'\') is distinct from coalesce(new.endereco,\'\')\n       and coalesce(new.geocod_nivel,\'\') in (\'\', \'cidade\', \'bairro\', \'falhou\') then\n      new.geocod_nivel := \'refazer\';\n    end if;\n  end if;');
  if n = d then raise exception 'preservar_e_derivar_endereco: trecho não encontrado'; end if;
  execute n;
end $$;
