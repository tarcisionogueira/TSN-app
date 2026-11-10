-- 10/11 (dono): título do e-book da Caixa com maiúscula e acento corretos. O slug da URL pública continua
-- o mesmo (leiloes-caixa-mais-facil-do-que-voce-imagina), então página indexada e feed não quebram.
update ebooks_admin set titulo = 'Leilões Caixa: Mais Fácil do que Você Imagina'
 where id = '619871ee-d8a6-483c-a08e-193aa53ab295';
