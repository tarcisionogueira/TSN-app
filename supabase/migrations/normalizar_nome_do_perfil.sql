-- =====================================================================================
-- NOME DE CLIENTE: "daniel" E "MOACIR EVERSON GONCALVES" NA MESMA LISTA (18/08)
--
-- A validação de nome no cadastro era `if (!form.nome)` — qualquer coisa não-vazia passava.
-- O resultado aparecia na lista de clientes do admin. Medido em 53 perfis:
--     2 com um nome só ("daniel", "Rayane") · 6 todos em minúsculo · 8 todos em maiúsculo
--
-- A régua nova é deliberadamente baixa — nome e sobrenome, sem número. Não é barreira de
-- entrada; é o mínimo para o cadastro servir para emitir contrato, conferir CPF ou falar
-- com o cliente. Ela vive em `src/lib/nome.js` (front) e `api/_nome.js` (servidor), na
-- mesma divisão já adotada para a senha.
--
-- Esta migração cuida da parte que NENHUM caminho contorna: a CAPITALIZAÇÃO, normalizada
-- por gatilho. O gatilho nunca rejeita — cadastro não quebra por causa dele; ele só arruma.
-- Rejeitar é trabalho do front e da API, que sabem devolver uma mensagem em português.
--
-- Backfill dos 53 perfis: 24 linhas mudaram, TODAS por capitalização ou espaço sobrando —
-- nenhum nome alterado em substância. Depois: 0 fora do padrão, 0 minúsculo, 0 maiúsculo.
-- Os 2 de nome único ficaram como estão: inventar sobrenome de cliente seria pior.
-- =====================================================================================

create or replace function public.normalizar_nome(s text)
returns text language plpgsql immutable as $$
declare
  limpo text := btrim(regexp_replace(coalesce(s,''), '\s+', ' ', 'g'));
  particulas text[] := array['de','da','do','das','dos','e','di','du','del','della','van','von','y','la','le'];
  palavras text[];
  palavra text;
  saida text[] := '{}';
  i int := 0;
begin
  if limpo = '' then return ''; end if;
  palavras := regexp_split_to_array(limpo, ' ');
  foreach palavra in array palavras loop
    i := i + 1;
    -- CamelCase INTENCIONAL (McDonald, DiCaprio): respeita — quem escreveu assim escreveu
    -- de proposito, e "corrigir" seria estragar o nome da pessoa. Exige que a palavra
    -- COMECE em maiuscula: a primeira versao testava so [[:lower:]][[:upper:]], e isso
    -- tambem casa com "jOAO" — erro de digitacao lido como intencao. O gatilho devolvia
    -- "jOAO da Silva Neto". Achado no teste ponta a ponta, nao nos casos que eu escrevi.
    if palavra ~ '^[[:upper:]]' and palavra ~ '[[:lower:]][[:upper:]]' then
      saida := saida || palavra;
      continue;
    end if;
    if i > 1 and lower(palavra) = any(particulas) then
      saida := saida || lower(palavra);
      continue;
    end if;
    -- Capitaliza a primeira letra e o que vem depois de hifen/apostrofo:
    -- "anna-maria" -> "Anna-Maria", "d'avila" -> "D'Avila".
    declare resto text := lower(palavra); montada text := ''; j int := 1; ch text;
    begin
      while j <= length(resto) loop
        ch := substr(resto, j, 1);
        if j = 1 or substr(resto, j-1, 1) in ('-', '''', '’') then
          montada := montada || upper(ch);
        else
          montada := montada || ch;
        end if;
        j := j + 1;
      end loop;
      saida := saida || montada;
    end;
  end loop;
  return array_to_string(saida, ' ');
end;
$$;

comment on function public.normalizar_nome(text) is
  'Espelho SQL de normalizarNome (src/lib/nome.js e api/_nome.js). NORMALIZA a capitalizacao, nunca rejeita — e a garantia que nenhum caminho de cadastro contorna. Conferido contra o JS em 12 casos reais do acervo: 12/12. Mudou um, mude os outros.';

create or replace function public.trg_normaliza_nome_perfil()
returns trigger language plpgsql as $$
begin
  if new.nome is not null then
    new.nome := public.normalizar_nome(new.nome);
  end if;
  return new;
end;
$$;

drop trigger if exists normaliza_nome_perfil on public.perfis;
create trigger normaliza_nome_perfil
  before insert or update of nome on public.perfis
  for each row execute function public.trg_normaliza_nome_perfil();

update public.perfis set nome = public.normalizar_nome(nome)
 where nome is distinct from public.normalizar_nome(nome);

-- =====================================================================================
-- E A SEGUNDA FONTE DO MESMO NOME (18/08, continuação)
--
-- Normalizar `perfis.nome` arrumou a lista do ADMIN e não arrumou o que o CLIENTE vê: o nome
-- também vive em `auth.users.raw_user_meta_data->>'nome'`, e é DAÍ que saem o cabeçalho
-- ("Olá, {primeiro nome}"), o chat de suporte, MeusChamados, Atendimento, Alavancagem e o
-- NOME DE FATURAMENTO do checkout — 12 pontos de leitura no front.
--
-- Ou seja: por algumas horas a mesma pessoa teve dois nomes. O admin via "Moacir Everson
-- Goncalves" e ela via "MOACIR EVERSON GONCALVES". 22 usuários nesse estado.
--
-- Os QUATRO pontos de escrita (Login, as 3 telas do Checkout via API, ConviteEquipe) já
-- gravam normalizado nos dois lugares — e o nome é READ-ONLY no Perfil, então não há outro
-- caminho de edição. Faltava só o acervo existente.
--
-- Testado em transação desfeita antes de aplicar: muda SÓ a chave `nome` (15 chaves antes,
-- 15 depois — jsonb_set não descarta nada). Depois: 0 fora do padrão nas duas fontes e
-- 0 divergências entre elas.
-- =====================================================================================
update auth.users
   set raw_user_meta_data = jsonb_set(raw_user_meta_data, '{nome}',
         to_jsonb(public.normalizar_nome(raw_user_meta_data->>'nome')))
 where raw_user_meta_data->>'nome' is not null
   and raw_user_meta_data->>'nome' is distinct from public.normalizar_nome(raw_user_meta_data->>'nome');

-- Dois invariantes novos em `qa_invariantes()` vigiam isto (aplicados via CREATE OR REPLACE
-- no mesmo dia; ver a função em produção):
--   `nome_fontes_divergentes` (limite 0) — as duas fontes voltaram a discordar.
--   `nome_sem_sobrenome`     (limite 2) — os DOIS legados são tolerados de propósito; um
--                                          terceiro significa que a regra nova vazou.
