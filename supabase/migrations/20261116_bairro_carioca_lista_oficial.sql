-- #368 (16/11): bairro do Rio que a lista curta de bairro_carioca() não conhecia. RYMERLEILOES ("Imóvel Com 2.528m² em
-- Vigário Geral", "…na Penha Circular", "…Alfa Corporate, São Cristóvão") e PORTELLA ficavam sem cidade com UF=RJ.
-- Três regras, da mais forte à mais fraca:
--   1. bairro OFICIAL da capital seguido de "/RJ", "- RJ" ou ", RJ" no texto → Rio de Janeiro (lista completa);
--   2. (como antes) fonte que só publica no RJ e cita um bairro da lista CURTA em qualquer ponto do texto;
--   3. NOVA: fonte só-RJ e o TÍTULO TERMINA em "em|na|no <bairro>" ou ", <bairro>" (lista completa).
-- A lista completa deixa de fora o que é palavra comum ou nome que toda cidade tem: Centro, Lagoa, Saúde, Penha (só
-- "Penha Circular"), Ramos, Lapa, Maré, Freguesia, Rocha, Tanque, Colégio, Benfica, Olaria, Piedade, Anil, Gamboa…
-- Medido em 16/11 sobre os ativos do RJ com cidade conhecida: 80 casos das regras novas, nenhum de outra cidade (os 14
-- "diferentes" eram grafia "Rio De Janeiro" ou o bairro gravado no lugar da cidade). Ganho imediato: 9 lotes sem cidade.
create or replace function public.bairro_carioca(p_titulo text, p_descricao text, p_ufs text[])
returns boolean language sql stable set search_path to 'public' as $$
  with t as (select ' ' || public.sem_acento(coalesce(p_titulo, '') || ' | ' || left(coalesce(p_descricao, ''), 3000)) || ' ' x,
                    public.sem_acento(coalesce(p_titulo, '')) tit),
  b as (select '(jacarepagua|barra da tijuca|barra olimpica|recreio dos bandeirantes|taquara|tijuca|copacabana|ipanema|leblon|botafogo|flamengo|laranjeiras|estacio|pilares|andarai|meier|bonsucesso|madureira|bangu|realengo|iraja|vila isabel|grajau|cachambi|engenho de dentro|del castilho|maracana|catete|humaita|gavea|sao conrado|vargem grande|vargem pequena|ilha do governador|guaratiba|pechincha|curicica|camorim|itanhanga|praca seca|cascadura|rio comprido|santa teresa|jardim botanico|vila da penha|marechal hermes|padre miguel|sepetiba|inhauma|lins de vasconcelos)' r,
               '(acari|agua santa|alto da boa vista|anchieta|andarai|bancarios|bangu|barra da tijuca|barra de guaratiba|barros filho|bento ribeiro|bonsucesso|botafogo|bras de pina|cachambi|cacuia|campinho|campo dos afonsos|campo grande|cascadura|catete|catumbi|cavalcanti|cidade de deus|cidade nova|cidade universitaria|cocota|coelho neto|comendador soares|copacabana|cordovil|cosme velho|costa barros|curicica|del castilho|deodoro|engenheiro leal|engenho da rainha|engenho de dentro|engenho novo|estacio|flamengo|gardenia azul|gavea|gloria|grajau|grumari|guadalupe|guaratiba|higienopolis|honorio gurgel|humaita|inhauma|inhoaiba|ipanema|iraja|itanhanga|jacarepagua|jacarezinho|jardim botanico|jardim carioca|jardim guanabara|jardim sulacap|laranjeiras|leblon|lins de vasconcelos|madureira|magalhaes bastos|maracana|marechal hermes|maria da graca|meier|paciencia|padre miguel|paqueta|parada de lucas|parque anchieta|parque columbia|pavuna|pechincha|pedra de guaratiba|penha circular|pilares|praca da bandeira|praca seca|praia da bandeira|quintino bocaiuva|realengo|recreio dos bandeirantes|riachuelo|ricardo de albuquerque|rio comprido|rocha miranda|santa cruz|santa teresa|santissimo|santo cristo|sao conrado|sao cristovao|sao francisco xavier|senador camara|senador vasconcelos|sepetiba|taquara|tijuca|todos os santos|tomas coelho|turiacu|vargem grande|vargem pequena|vasco da gama|vaz lobo|vicente de carvalho|vidigal|vigario geral|vila da penha|vila isabel|vila kosmos|vila militar|vila valqueire)' s)
  select x ~ ('[^a-z]' || s || '\s*(/|-|–|,)\s*rj[^a-z]')
      or (p_ufs = array['RJ'] and x ~ ('[^a-z]' || r || '[^a-z]'))
      or (p_ufs = array['RJ'] and tit ~ ('(\m(em|na|no|nos|nas)\s+|,\s*)' || s || '\s*[.]?\s*$'))
    from t, b
$$;
