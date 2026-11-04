# Discordia

Salas de texto, voz, vídeo e compartilhamento de tela entre amigos, direto no navegador ou no app de computador.
O computador de quem cria a sala é o host: conversa e chamadas passam entre os participantes.
O único servidor é um Worker mínimo que liga o código da sala ao host e entrega convites e mensagens entre amigos, sempre cifrados de ponta a ponta.

As decisões técnicas e os limites estão em [docs/AUDITORIA.md](docs/AUDITORIA.md).

## Rodar localmente

```bash
npm install
npm run dev:signal   # sinalização em http://localhost:8787
npm run dev          # app em http://localhost:5173
```

Abra duas janelas anônimas para simular duas pessoas.

## Chamada de teste entre aparelhos

Câmera e microfone exigem HTTPS fora do `localhost`. Este comando sobe tudo e cria um link público temporário, sem conta:

```bash
npm run call
```

Abra o link nos dois aparelhos. Enquanto o comando rodar, quem tiver o link acessa o servidor de desenvolvimento; `Ctrl+C` encerra tudo.

## Testar

```bash
npm test             # lógica do host
npm run check        # tipos
npm run e2e          # navegadores reais com mídia simulada
```

Os testes de ponta a ponta precisam de `npx playwright install chromium firefox`.

## Publicar

Exige contas gratuitas na Cloudflare e na Vercel.

### 1. Worker de sinalização

```bash
npx wrangler login
npx wrangler deploy --config worker/wrangler.toml
```

Anote o endereço, algo como `https://discordia-signal.SEU-USUARIO.workers.dev`.

### 2. Site

1. Importe este repositório na Vercel. O preset Vite é detectado sozinho.
2. Em **Environment Variables**, crie `VITE_SIGNAL_URL` com o endereço do Worker. Sem ela o build falha de propósito.
3. Faça o deploy e anote o domínio.

### 3. Restringir o Worker ao seu site

Em `worker/wrangler.toml`, preencha a origem e publique de novo:

```toml
ALLOWED_ORIGINS = "https://SEU-SITE.vercel.app,app://discordia"
```

`app://discordia` é a origem do app de computador; sem ela, o app não consegue criar nem entrar em salas.

### 4. Aparecer nas buscas

O build já gera título e descrição, cartão de compartilhamento (`og.png`), dados estruturados, `robots.txt` e `sitemap.xml`. Na Vercel o endereço vem sozinho do domínio de produção; em outro lugar, defina `VITE_PUBLIC_URL`. Para o Google listar o site:

1. Abra o [Google Search Console](https://search.google.com/search-console) e adicione o domínio do site.
2. Escolha a verificação por **tag HTML**, copie só o valor de `content` e defina `VITE_GOOGLE_SITE_VERIFICATION` com ele na Vercel. Publique de novo e clique em **Verificar**.
3. Em **Sitemaps**, envie `sitemap.xml`.

A primeira indexação costuma levar de alguns dias a algumas semanas. "Discordia" também é uma palavra comum, então no começo o site aparece mais fácil em buscas como "Discordia salas de voz".

Depois de mudar a logo, `node scripts/icons.mjs` gera de novo os ícones e a imagem de compartilhamento.

### 5. TURN (recomendado)

Sem TURN, quem estiver atrás de NAT restritivo não conecta. O Worker usa a Metered, com 50 GB grátis por mês e sem cartão: `METERED_APP` fica em `worker/wrangler.toml`, e a chave vai como segredo:

```bash
npx wrangler secret put METERED_API_KEY --config worker/wrangler.toml
```

A alternativa é o TURN da Cloudflare, com 1.000 GB grátis por mês, que pede cartão.

1. No painel da Cloudflare, abra **Realtime → TURN** e crie uma chave.
2. Grave os dois segredos:

```bash
npx wrangler secret put TURN_KEY_ID --config worker/wrangler.toml
npx wrangler secret put TURN_KEY_API_TOKEN --config worker/wrangler.toml
```

## App de computador

O mesmo app, em Electron, com o que o navegador não permite: atalhos que funcionam dentro do jogo, mini janela por cima dos outros programas, ícone na bandeja, iniciar com o sistema, links `discordia://AB7-K2Q` e áudio do computador na transmissão de tela (Windows).

```bash
npm run desktop:dev    # abre o app apontando para a sinalização local (rode npm run dev:signal antes)
npm run desktop:dist   # gera o instalador do sistema atual em desktop/release
```

Para o app falar com o Worker publicado, gere com `VITE_SIGNAL_URL` (Worker) e `VITE_PUBLIC_URL` (site, usado no link de convite). A cada tag `v*`, o GitHub Actions gera os instaladores de Windows, macOS e Linux e publica no Release; o app se atualiza a partir dali. Defina as duas variáveis em **Settings → Secrets and variables → Actions → Variables**.

- **Assinatura:** sem certificado, o Windows mostra "Editor desconhecido" e o macOS bloqueia o app na primeira abertura. Os segredos `CSC_LINK` e `CSC_KEY_PASSWORD` ativam a assinatura no CI.
- **Linux:** o sandbox do Chromium precisa de `chrome-sandbox` com dono root e SUID (`sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox`); o pacote `.deb` já faz isso. Atalhos globais funcionam no X11; no Wayland, só com programas do XWayland.
- **macOS:** apertar para falar global pede a permissão de Acessibilidade; o áudio do computador na transmissão ainda não é capturado.
- **Mini janela:** começa compacta (só os rostos, com destaque em quem fala, e o microfone) e expande para nomes e controles; lembra o modo e o lugar onde foi arrastada. Aparece sobre jogos em tela cheia "sem bordas"; tela cheia exclusiva fica por cima dela.

## Atalhos

| Ação | Tecla |
|---|---|
| Mudo | `Alt+Shift+M` |
| Ensurdecer | `Alt+Shift+D` |
| Rádio: pausar, próxima, volume | `Alt+Shift+P`, `Alt+Shift+N`, `Alt+Shift+↑/↓`, e as teclas de mídia |
| Apertar para falar | Configurável (padrão `V`) |

No navegador, os atalhos só funcionam com a janela em foco. No app de computador eles são globais durante a chamada.

## Desempenho

O botão de medidor no topo da sala abre as métricas: pressão da CPU, memória JS, atraso da interface, ping, banda, perda de pacotes, vídeo por pessoa e tempo de codificação. A coleta só roda com o painel aberto.

Sites não conseguem ler a porcentagem de CPU e a RAM total. Para esses números, use `Shift+Esc` no Chrome ou Edge.

Antes de sair, a voz passa por um tratamento: uma IA (RNNoise) remove teclado, ventilador e barulho de fundo, e uma porta corta o som enquanto a pessoa não fala. Volume do microfone e sensibilidade ficam nas configurações, e valem na hora.

O **Modo jogo**, no botão de controle ao lado do microfone, é o melhor para jogar: não recebe vídeo, tira os efeitos, corta o envio no silêncio e usa pacotes de áudio maiores (cerca de 20 ms a mais de atraso). A parte de áudio vale ao entrar na voz.

O modo economia, nas configurações, tira os efeitos visuais e reduz a câmera. Ele liga sozinho quando o navegador informa pressão alta.

## Amigos e mensagens

Quem esteve numa sala com você vira amigo recente, na tela inicial e no botão **Amigos** da sala. Dá para mandar mensagem e marcar amigos para **criar uma sala nova já chamando eles**: o convite chega como um cartão com o botão **Entrar**, com som e notificação do sistema se a janela estiver em segundo plano. No app de computador, isso funciona também com o app minimizado na bandeja.

- **Privacidade:** cada navegador gera um par de chaves (ECDH P-256) que nunca sai dele. A chave pública vai junto do perfil nas salas, e as mensagens são cifradas com AES-GCM antes de sair. O Worker só vê envelopes que não consegue ler, e quem enviou é carimbado pela caixa de entrada autenticada: ninguém manda em nome de outro.
- **Entrega:** na hora, se o amigo estiver com o Discordia aberto; senão o envelope espera até 7 dias (no máximo 50 por pessoa) e é apagado do Worker assim que entregue. O histórico fica só nos navegadores das duas pessoas.
- **Controle:** remover alguém dos recentes ou bloquear; bloqueado, o Worker descarta o que a pessoa mandar, sem avisá-la.
- **Deploy:** a caixa de entrada é um Durable Object novo (`Inbox`, migração `v2` em `worker/wrangler.toml`). O próximo `npx wrangler deploy` a cria.

## Limites

| Uso | Limite |
|---|---|
| Pessoas por sala | 20 |
| Pessoas por canal de voz | 10 |
| Vídeo com boa qualidade | ~4 câmeras |
| Tela | 5 espectadores por transmissão; o bitrate cai a partir do terceiro |
| Arquivos | 2 MB |

- O rádio toca só no canal de voz em que começou. Fila de até 200 faixas, em loop; cada playlist importa até 100. Música nova toca a seguir, e todos no canal controlam. Atalhos: Alt+Shift+P pausa, Alt+Shift+N pula, Alt+Shift+↑/↓ volume.
- A sala termina quando o host encerra ou fecha a aba, após 30 s de carência. Recarregar a página (F5) não encerra: a sala volta com o mesmo código, e os convidados reconectam sozinhos.
- O histórico fica na memória do host e dura só a sessão.
- Áudio de tela depende de Chrome ou Edge; o Firefox compartilha a tela sem som. Para o som de um jogo no Windows, escolha "Tela inteira" e ligue "Compartilhar áudio do sistema".
- Participantes em conexão direta conseguem ver o IP uns dos outros.
- Banimento vale por navegador, pois não há contas: limpar os dados do site contorna.
