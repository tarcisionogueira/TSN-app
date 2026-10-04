# Roteiro — arquivar lotes inativos (para o dono, no SQL Editor do Supabase)

**Por que você e não o Claude:** a função apaga linhas da tabela quente (depois de copiá-las para o
arquivo) e o conector do Supabase exige confirmação humana para comando destrutivo. Já está pronto
no banco: a tabela `imoveis_leilao_arquivo`, a view `imoveis_leilao_indice_base` e o Índice BidPro
lendo a view. Falta só o que segue.

1. **Criar a função e fechar as permissões** — cole e rode o arquivo inteiro
   `supabase/migrations/20261004_arquivo_lotes_inativos.sql` (é idempotente: o que já existe é pulado).

2. **Simular (não mexe em nada):**
   ```sql
   select public.arquivar_lotes_inativos(2, true);
   ```
   Esperado: ~7.500 elegíveis (8.802 inativos há 2+ meses, menos 1.103 com resultado de leilão
   apurado e os referenciados em alguma tabela).

3. **Arquivar de verdade:**
   ```sql
   select public.arquivar_lotes_inativos(2, false);
   ```
   Confira no retorno: `arquivados` = `removidos_da_quente`.

4. **De madrugada (fora das coletas), encolher o arquivo da tabela** — trava a tabela ~1 min:
   ```sql
   vacuum full public.imoveis_leilao;
   ```

5. **No dia seguinte**, o Claude confere `qa_invariantes_execucao.ms_servidor` da rodada das 18:10 UTC
   e o tamanho: `select pg_size_pretty(pg_total_relation_size('imoveis_leilao'));` (antes: 295 MB).
