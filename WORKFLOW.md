Este é o workflow que eu quero que o bot siga:
O bot deve ser resiliente e tentar novamente em caso de erro, e fugir de ads que podem aparecer aleatoriamente. Tente sempre usar locators mais gerais e não especificos.
0. Login na página do SAPO Emprego, caso não esteja autenticado:
    0.1 Ir para https://login.sapo.pt/LoginWithToken.do?to=https%3A%2F%2Femprego.sapo.pt%2F
    0.2 Introduzir o email (env.SAPO_AUTH_EMAIL), clicar no botão continuar;
    0.3 Introduzir a password (env.SAPO_AUTH_PASSWORD), clicar no botão continuar;
    0.4 Verificar se foi autenticado, caso contrário, retornar erro;
1. Entrar no site https://emprego.sapo.pt/ ou fazer a lógica com https://emprego.sapo.pt/offers?local=${encodeURIComponent(location)}&pesquisa=${encodeURIComponent(keywords)} feita no sapo adapter.ts:
    1.1. Pesquisar as vagas gerais:
        1.1.1 Aceitar todos os cookies;
        1.1.2 Fechar todos anuncios e popups;
        1.1.3 Preencher o de input com o label que contém "palavra-chave" com: "Javascript" [por agora, temos uma lista de palavras-chave];
        1.1.4 Clicar no campo input dropdown com placeholder "DISTRITO" e selecionar a opção  "Lisboa";
        1.1.5 Clicar no botão com o texto "PROCURAR";
    1.2. Pesquisar as vagas específicas:
        1.2.1 Fechar todos anuncios e popups se houverem;
        1.2.2 Verificar se já temos a pesquisa com os parâmetros desejados, caso contrário realizar a pesquisa [mesma lógica do ponto 1.1.];
        1.2.3 Obter lista de vagas [https://emprego.sapo.pt/search-results/offers?local=Lisboa&pesquisa=<PalavraChave da vaga que procuramos>];
        1.2.4 Assim que encontramos a vaga duplicamos a tab [para manter a pesquisa na tab original];
    1.3. Candidatar-se a cada vaga:
        1.3.1 No duplicado: Clicar no botão "Candidate-se" da primeira vaga (ps. A primeira vaga é aquela que tiver o primeiro botão de "candidate-se" ou "CANDIDATE-SE", não necessariamente o primeiro botão da página);
        1.3.2 Assim que entrar-mos na página da vaga, procurar o botão "candidate-se" ou "CANDIDATE-SE" e clicar nele;
        1.3.3 Preencher o formulário com os dados do usuário explicados em Apply.Form.md;
        1.3.4 Ja não iremos fazer upload do CV, apenas preencher o campo correspondente, pelo dropdown de "CV" com o valor de "edig_it_2026" descritos em Apply.Form.md;
        1.3.5 Aceitar os termos e condições;
        1.3.6 Clicar em "enviar candidatura" ou "ENVIAR CANDIDATURA";
        1.3.7 IMPORTANTE: Só aceitar o captcha se der erro no captcha, caso não tentar enviar normalmente, caso continue dando erro voltar ao ponto 1.3 e corrigir o erro que aparecer;
        1.3.8 Em caso de sucesso escrever na DATABASE;
        1.3.9 Feito isso fechar a tab e ir para a próxima vaga;
    1.4. Caso tenha terminado todas as vagas, clicar em proximo e repetir o processo de 1.3;
    1.5. Se não tiver mais vagas, ir para a próxima palavra-chave da lista e repetir o processo em 1;
    1.6. Caso tenha terminado todas as palavras-chave, o programa deve passar para o ponto 2;
2. Enviar um email para ediigmelchiior@gmail.com:
    - Assunto: Candidaturas de [Data]
    - Corpo: "Foram enviadas X candidaturas hoje"
    - Escrever a lista de vagas que foram enviadas.
    - Terminado o processo, o programa deve parar e voltar no dia seguinte no ponto 1.
    
    
    