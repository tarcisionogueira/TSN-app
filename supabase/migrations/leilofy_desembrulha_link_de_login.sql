-- 23/09 — LEILOFY publica matrícula/laudo como `/login?redirect=_admin_%2Fupload%2F<x>.pdf`.
-- O espelho recusava ("resposta HTML") e o e-mail ao leiloeiro anexou a TELA DE LOGIN como
-- "MATRÍCULA". O arquivo fica na mesma pasta pública de onde o espelho já copia laudo/edital
-- (`/_admin_/upload/*.pdf`). Reescreve para o endereço direto; o scraper já grava assim daqui
-- em diante (urlDiretaDoDocumento em api/_anexo-nome.js).
update imoveis_leilao set
  anexos = regexp_replace(anexos::text,
    '(https?://[^/"]+)/login\?redirect=_admin_%2Fupload%2F([A-Za-z0-9]+\.(pdf|jpe?g|png))',
    '\1/_admin_/upload/\2', 'gi')::jsonb,
  link_matricula = regexp_replace(link_matricula,
    '^(https?://[^/]+)/login\?redirect=_admin_%2Fupload%2F([A-Za-z0-9]+\.(pdf|jpe?g|png))$', '\1/_admin_/upload/\2', 'i'),
  link_edital = regexp_replace(link_edital,
    '^(https?://[^/]+)/login\?redirect=_admin_%2Fupload%2F([A-Za-z0-9]+\.(pdf|jpe?g|png))$', '\1/_admin_/upload/\2', 'i')
where anexos::text ~ '/login\?redirect=_admin_%2Fupload%2F'
   or link_matricula ~ '/login\?redirect=_admin_%2Fupload%2F'
   or link_edital ~ '/login\?redirect=_admin_%2Fupload%2F';
