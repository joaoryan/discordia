# Discordia

Salas de texto, voz, vídeo e compartilhamento de tela entre amigos, direto no navegador.
O computador de quem cria a sala é o host: conversa e chamadas passam entre os participantes.
O único servidor é um Worker mínimo que liga o código da sala ao host.

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
ALLOWED_ORIGINS = "https://SEU-SITE.vercel.app"
```

### 4. TURN (recomendado)

Sem TURN, quem estiver atrás de NAT restritivo não conecta. O plano gratuito da Cloudflare cobre 1.000 GB por mês.

1. No painel da Cloudflare, abra **Realtime → TURN** e crie uma chave.
2. Grave os dois segredos:

```bash
npx wrangler secret put TURN_KEY_ID --config worker/wrangler.toml
npx wrangler secret put TURN_KEY_API_TOKEN --config worker/wrangler.toml
```

## Atalhos

| Ação | Tecla |
|---|---|
| Mudo | `Alt+Shift+M` |
| Ensurdecer | `Alt+Shift+D` |
| Apertar para falar | Configurável (padrão `V`), com a janela em foco |

## Desempenho

O botão de medidor no topo da sala abre as métricas: pressão da CPU, memória JS, atraso da interface, ping, banda, perda de pacotes, vídeo por pessoa e tempo de codificação. A coleta só roda com o painel aberto.

Sites não conseguem ler a porcentagem de CPU e a RAM total. Para esses números, use `Shift+Esc` no Chrome ou Edge.

O **Modo jogo**, no botão de controle ao lado do microfone, é o melhor para jogar: não recebe vídeo, tira os efeitos, corta o envio no silêncio e usa pacotes de áudio maiores (cerca de 20 ms a mais de atraso). A parte de áudio vale ao entrar na voz.

O modo economia, nas configurações, tira os efeitos visuais e reduz a câmera. Ele liga sozinho quando o navegador informa pressão alta.

## Limites

| Uso | Limite |
|---|---|
| Pessoas por sala | 20 |
| Pessoas por canal de voz | 10 |
| Vídeo com boa qualidade | ~4 câmeras |
| Tela | 5 espectadores por transmissão; o bitrate cai a partir do terceiro |
| Arquivos | 2 MB |

- O rádio toca só no canal de voz em que começou. Fila de até 200 faixas; cada playlist importa até 100.
- A sala termina quando o host encerra ou fecha a aba, após 30 s de carência. Recarregar a página (F5) não encerra: a sala volta com o mesmo código, e os convidados reconectam sozinhos.
- O histórico fica na memória do host e dura só a sessão.
- Áudio de tela depende de Chrome ou Edge; o Firefox compartilha a tela sem som. Para o som de um jogo no Windows, escolha "Tela inteira" e ligue "Compartilhar áudio do sistema".
- Participantes em conexão direta conseguem ver o IP uns dos outros.
- Banimento vale por navegador, pois não há contas: limpar os dados do site contorna.
