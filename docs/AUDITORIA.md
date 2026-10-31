# Auditoria técnica — Discordia v1

Data: 31/10/2026. Preços e limites foram conferidos na documentação oficial nessa data (fontes no fim).
Os limites de pessoas são **estimativas de engenharia** calculadas a partir de banda e custo de codificação. Ainda não foram medidos com pessoas reais.

## Resumo executivo

| Decisão | Escolha | Motivo em uma frase |
|---|---|---|
| Plataforma | PWA na Vercel | Link único, atualização instantânea, sem instalador |
| Topologia | **Híbrida**: dados em estrela no host, mídia em malha | Navegador não encaminha mídia sem recodificar |
| Sinalização | Cloudflare Worker + Durable Object, cerca de 200 linhas | Único componente servidor; também protege as credenciais TURN |
| Tempo real | WebRTC nativo, sem biblioteca | Precisamos de controle fino de trilhas e bitrate |
| NAT | STUN + Cloudflare TURN (1.000 GB grátis por mês) | 10–25% das sessões precisam de relay |
| Queda do host | F5 retoma a sala; fechar a aba encerra após 30 s | Migração custa muito e entrega pouco na v1 |
| Front-end | Svelte 5 + Vite + CSS próprio | Bundle pequeno e sem runtime pesado |
| Dados locais | localStorage (perfil), IndexedDB só no futuro | Não há nada grande para guardar na v1 |

**O que não dá para cumprir ao pé da letra:**

1. **"Sem backend" absoluto não é viável com código de sala curto.** Dois navegadores não se encontram sozinhos; alguém precisa ligar `AB7-K2Q` ao host. A alternativa 100% sem servidor é trocar oferta/resposta WebRTC manualmente, o que quebra o fluxo pedido. Depois da conexão, nenhum dado da conversa passa pelo Worker.
2. **"O host retransmite áudio e vídeo" não é viável num navegador.** Só texto e controle passam pelo host. A mídia vai direto entre participantes.
3. **Áudio de sistema só funciona bem em Chromium.** Firefox não captura áudio pelo `getDisplayMedia`. Compartilhar tela funciona, mas sem som.

## Arquitetura

```text
             (só para se encontrar; sem conteúdo)
          ┌──────── Cloudflare Worker + Durable Object ────────┐
          │  código → host · repassa SDP/ICE · emite TURN      │
          └───────▲──────────────────▲───────────────▲─────────┘
                  │ WebSocket fica    │ WebSocket fecha ao conectar
                  │ aberto no host    │               │
            ┌─────┴─────┐       ┌─────┴────┐    ┌─────┴────┐
            │   HOST    │◄═════►│ Amigo A  │    │ Amigo B  │
            │ autoridade│  DC   └────┬─────┘    └─────┬────┘
            │ (membros, │◄═══════════╪════════════════╝ DC
            │ histórico)│            │                │
            └─────┬─────┘            └──── mídia ─────┘
                  └─────────── mídia ───── (malha, SRTP direta)

  ═══ DataChannel em estrela: chat, membros, sinalização da malha
  ─── Áudio/vídeo/tela em malha, só entre quem está no mesmo canal de voz
```

Se a conexão direta falhar, os dois lados passam a usar TURN automaticamente. O TURN só enxerga pacotes cifrados.

## 1. Plataforma

| | PWA (Vercel) | Tauri | Electron |
|---|---|---|---|
| Download | ~45 KB de JS gzip (medido) | ~10 MB | ~100 MB ou mais |
| RAM | Compartilhada com o navegador | Baixa | Alta |
| Motor WebRTC | Chrome/Edge/Firefox atuais | WebView do SO; varia e é fraco no WebKitGTK | Chromium conhecido |
| Tela | `getDisplayMedia` | Depende da WebView | `desktopCapturer` completo |
| Áudio de sistema | Aba (Chromium); sistema no Windows/ChromeOS | Depende da WebView | Melhor cenário |
| Distribuição | Link | Instalador e assinatura | Instalador e assinatura |
| Atualização | Instantânea | Auto-updater | Auto-updater |
| Custo | Grátis | Certificados pagos para evitar alertas | Certificados pagos para evitar alertas |
| Aprendizado | Baixo | Médio (Rust) | Médio |

**Recomendação: PWA.** O amigo precisa entrar em segundos, e instalador é uma barreira. O Tauri perde justamente onde importa, porque herda a WebRTC da WebView. Se a falta de áudio de sistema incomodar, o Electron pode embrulhar o mesmo front-end na v2.

## 2. Topologia e limites

Um navegador não tem SFU. Para retransmitir, ele decodifica e recodifica cada trilha, o que custa CPU e soma latência. Pior: com N pessoas num hub, o host precisaria recodificar N−1 trilhas para cada um dos N−1 participantes.

| | Malha | Host como hub | **Híbrido (escolhido)** |
|---|---|---|---|
| Conexões | N(N−1)/2 | N−1 | Malha só em quem está na voz |
| Latência de mídia | Mínima | Soma decodificação + recodificação | Mínima |
| Carga no host | Igual à dos outros | Altíssima | Igual à dos outros, mais o chat |
| Upload de cada um | N−1 × bitrate | Baixo, exceto o host | N−1 × bitrate |
| Expulsar alguém | Precisa de coordenação | Trivial | Trivial: o host corta a sinalização |
| Autoridade sobre o chat | Difícil | Natural | Natural |

**Limites realistas estimados por sala:**

| Uso | Malha / híbrido | Hub no navegador | Base do cálculo |
|---|---|---|---|
| Texto | 20+ | 20+ | Mensagens pequenas; limite fixado em 20 |
| Voz | **10** (limite do app) | 4–5 | ~50 kbps por par: 8 pessoas = 350 kbps de upload |
| Vídeo | **4** (até 6 em 360p) | 2–3 | ~500 kbps por par; a CPU limita antes da banda |
| Tela (1 transmissor) | **5 espectadores** (limite do app) | 3–4 | 2,5 Mbps × espectador: 5 = 12,5 Mbps de upload |

Duas decisões reduzem a carga: a tela só é enviada a quem clicar em "Assistir", e o bitrate do vídeo cai conforme a sala cresce.

## 3. Sinalização

| Opção | Sem servidor próprio? | Confiabilidade | Custo | Prós | Contras |
|---|---|---|---|---|---|
| Troca manual de SDP | **Sim, 100%** | Alta | Zero | Sem dependências | Colar blocos enormes, duas vezes, por pessoa |
| PeerJS Cloud | Sim, de terceiro | Sem SLA; há relatos de quedas | Zero | Zero infraestrutura | Serviço comunitário; lib estagnada desde 2025 |
| Trystero (Nostr/MQTT/torrent) | Sim, de terceiros | Depende de relays públicos | Zero | Sem conta nenhuma | Conexão variável, difícil de depurar |
| Vercel Functions | Não | — | Grátis | Mesma plataforma | Sem conexão persistente; exige polling e um banco externo |
| **Worker + Durable Object** | Não; ~200 linhas nossas | Alta | Grátis para este uso | WebSocket real, emite TURN, controlamos tudo | Exige conta na Cloudflare |

**Recomendação: Worker + Durable Object.** O plano grátis dá 100 mil requisições/dia, e mensagens WebSocket recebidas contam na razão 20:1. Com a API de hibernação, conexões ociosas não consomem duração. Uma entrada na sala custa poucas dezenas de mensagens, então o limite é folgado para um grupo de amigos.

O motivo decisivo é o TURN: as credenciais precisam de um segredo guardado no servidor. Qualquer opção "sem servidor" exigiria colocar esse segredo no JavaScript público, ou ficar sem TURN e deixar de fora até um quarto das conexões.

## 4. NAT, STUN e TURN

Fontes do setor estimam que **10–25% das sessões** precisam de relay; ~20% é o número mais citado. Redes corporativas e CGNAT móvel puxam isso para cima.

| Serviço | Tipo | Grátis | Depois | Observação |
|---|---|---|---|---|
| `stun.cloudflare.com` | STUN | Ilimitado | — | Usado por padrão |
| **Cloudflare TURN** | TURN | **1.000 GB/mês** | US$ 0,05/GB | Credenciais temporárias via API |
| Open Relay (Metered) | TURN | 20 GB/mês | Plano pago | Segunda opção |
| coturn em VPS | TURN | — | ~US$ 5/mês | Exige manter servidor |

Como referência, 1.000 GB equivalem a cerca de 2.200 horas de vídeo a 1 Mbps. Voz é ordens de grandeza menos.

Sem as credenciais TURN configuradas, o app funciona só com STUN, e quem estiver atrás de NAT restritivo simplesmente não conecta.

## 5. Quando o host cai

| Opção | Complexidade | Resultado |
|---|---|---|
| **Encerramento limpo** | Baixa | Todos veem "A sala foi encerrada" |
| Migração de host | Alta | Exige replicar estado, eleger sucessor, trocar a posse do código e lidar com falhas durante a eleição |

**Recomendação: encerramento limpo.** A proteção vem de outros lugares:

- Ao fechar a aba, o navegador pede confirmação ao host.
- Queda rápida da internet do host não mata a sala: a reconexão ao Worker tem 30 s de carência.
- Batimentos a cada 5 s detectam travamento; sem resposta por 15 s, a pessoa sai da sala.
- O Chrome não aplica o throttling intenso de timers em páginas com WebRTC ativo, então o host em aba de fundo continua funcionando.
- O código de sala morre junto com o host.

O F5 do host não encerra a sala: o estado vai para o `sessionStorage` e o host retoma o mesmo código. Os convidados mantêm o id, então a voz entre eles não cai. Fechar a aba apaga esse estado, e a sala acaba após a carência de 30 s. Anexos só sobrevivem até ~3 MB; os mais antigos expiram.

## 6. Comunicação em tempo real

| | WebRTC nativo | PeerJS | simple-peer | libp2p | Trystero |
|---|---|---|---|---|---|
| Peso | 0 KB | Médio | Médio | Muito alto | ~17 KB gzip |
| Último release | Navegador | 1.5.5 (jun/2025) | 9.11.1 (jan/2023) | Ativo | Ativo (out/2026) |
| Renegociação de trilhas | Total | Limitada | Sim | Não é o foco | Abstraída |
| Controle de bitrate | Total | Parcial | Parcial | — | Parcial |
| Aprendizado | Médio/alto | Baixo | Baixo | Alto | Baixo |

**Recomendação: WebRTC nativo.** A funcionalidade central é ligar e desligar câmera e tela no meio da chamada, com bitrate por conexão, e isso é exatamente o que as bibliotecas escondem. O padrão *Perfect Negotiation* resolve a renegociação em cerca de 100 linhas. simple-peer está parado desde 2023, e libp2p resolve um problema que não temos.

## 7. Áudio, vídeo e tela

| Tema | Decisão |
|---|---|
| Microfone | `getUserMedia` com `echoCancellation`, `noiseSuppression` e `autoGainControl` ligados, configuráveis |
| Câmera | 640×360, ~500 kbps, reduzindo quando há mais de 3 pares |
| Tela | `getDisplayMedia`; texto (1080p15, 2,5 Mbps), movimento (720p30, 2,5 Mbps) ou alta (1080p30, 4,5 Mbps). 1080p60 (6 Mbps) está comentado no código, reservado para o futuro |
| Áudio | Opus, padrão do WebRTC, com FEC nativo |
| Vídeo | Deixar o navegador escolher (VP8/VP9/H.264). AV1 consome mais CPU, o que pesa em malha |
| Bitrate | `RTCRtpSender.setParameters` em cada conexão |
| Indicador de fala | Cada um mede o próprio microfone e avisa pelo DataChannel; evita um analisador por pessoa |
| Mudo | `track.enabled = false`: instantâneo, sem renegociar |
| Supressão por IA (estilo Krisp) | Fora da v1: pesa e o supressor nativo atende |

**Compatibilidade de áudio de tela:**

| Navegador | Vídeo da tela | Áudio da aba | Áudio do sistema |
|---|---|---|---|
| Chrome/Edge | Sim | Sim | Windows/ChromeOS, em tela inteira |
| Firefox | Sim | Não | Não |
| Celular | Limitado | Não | Não |

### Rádio

| | YouTube sincronizado | Áudio de uma aba |
|---|---|---|
| Como funciona | Cada pessoa toca o player oficial; a sala combina só fila e posição | Captura o som da aba e envia em malha, sem vídeo |
| Upload de quem criou | Praticamente zero | ~130 kbps por ouvinte |
| CPU | Um player de vídeo por pessoa | Codificação Opus por ouvinte |
| Navegadores | Todos | Chrome e Edge |
| Sincronia | Corrige atraso acima de 3 s; não é perfeita | Quase ao vivo |
| Anúncios | Podem aparecer para cada pessoa | Vêm da aba de origem |

**Regras do YouTube atendidas:** player visível, ao menos 200×200, nada por cima, e cabeçalho Referer enviado. A autorização de incorporação é de cada vídeo; os bloqueados são pulados.

**Vídeo no YouTube:** as políticas proíbem separar áudio de vídeo e usar player em segundo plano, então o player fica visível no tamanho mínimo (200×200) e é pausado para quem silencia o rádio.

**Spotify:** sem integração. O SDK exige Premium e a licença cobre uso pessoal e privado. O modo de aba é genérico; usá-lo com um serviço de streaming é decisão de quem transmite e pode contrariar os termos desse serviço.

## 8. Front-end

| | Svelte 5 | Solid | Preact | React | Vue | Vanilla |
|---|---|---|---|---|---|---|
| Runtime (gzip) | Mínimo; compilado | ~7 KB | ~4 KB | ~45 KB | ~35 KB | 0 |
| Desempenho | Excelente | Excelente | Bom | Médio | Bom | Excelente |
| Estado | Runes, sem lib | Signals, sem lib | Signals à parte | Lib à parte | Pinia opcional | Manual |
| CSS com escopo | Nativo | Não | Não | Não | Nativo | Não |
| Aprendizado | Baixo | Médio | Baixo | Baixo | Baixo | Sobe com a UI |

Os números são aproximados, pois benchmarks públicos divergem. **Escolha: Svelte 5 + Vite + TypeScript.** O CSS com escopo e o estado por runes eliminam Tailwind e lib de estado. Estilo: CSS próprio com variáveis. Sem roteador: o app tem poucas telas, trocadas por estado.

## 9. Interface

**Estrutura:** quatro colunas, como o Discord: trilho de servidores (72 px), canais + painel do usuário (240 px), conteúdo flexível, membros (240 px; some em telas estreitas).

**Identidade própria:** o nome vem do mito da maçã dourada de Éris. A logo é um balão de fala com um raio recortado, a conversa e a discórdia. Há quatro temas só com variáveis CSS, com desenhos originais e sem marcas de jogos. Nenhum asset, som ou marca do Discord é usado.

| Item | Decisão |
|---|---|
| Ícones | SVG próprios embutidos, sem dependência |
| Fontes | Inter variável, hospedada no próprio site (fonte aberta, licença OFL) |
| Animações | CSS curto (100–200 ms), respeitando `prefers-reduced-motion` |
| Sons | Sintetizados com WebAudio; sem arquivos |

**Telas:** perfil inicial · início (criar/entrar) · entrada por código · sala com canais · visão de voz/vídeo · configurações de áudio e vídeo · escolha de qualidade da tela · convite · sala encerrada/expulso.

## 10. Armazenamento local

| Dado | Onde | Motivo |
|---|---|---|
| Perfil, avatar pequeno, configurações, salas recentes | localStorage | Pequeno e síncrono |
| Histórico do host (futuro) | IndexedDB | Grande e assíncrono |
| Histórico da sessão | Memória do host | Requisito é só "da sessão" |

O avatar é reduzido para 96×96 antes de salvar, para caber no limite de ~5 MB do localStorage.

## 11. Segurança e privacidade

| Tema | Decisão |
|---|---|
| Código | 6 caracteres de 31 símbolos sem ambíguos (~887 milhões de combinações), gerado com `crypto.getRandomValues` |
| Validade | Enquanto o host estiver na sala; removido no Worker depois |
| Força bruta | Limite de tentativas por IP no Worker e cota diária baixa inviabilizam varredura |
| Posse da sala | Chave secreta do host, necessária para reconectar |
| Falsificação | O host carimba o remetente; um participante não fala em nome de outro |
| Conteúdo malicioso | Texto renderizado sem HTML; SVG recusado; tamanhos validados no host |
| Moderação | Host pode expulsar, banir e trancar a sala |
| Banimento | Por ID local; **burlável** limpando os dados do navegador, pois não há contas |
| Abuso do TURN | Credenciais temporárias e verificação de `Origin` |
| Criptografia | Mídia em SRTP e dados em DTLS, obrigatórios no WebRTC |

**Limitações honestas:**

- Isto não é criptografia de ponta a ponta verificada. Quem controlar a sinalização poderia, em teoria, trocar as impressões digitais DTLS e se colocar no meio. Como o Worker é nosso, o risco é aceitável na v1.
- O host vê todas as mensagens em claro, porque é ele quem as distribui.
- Em malha direta, os participantes veem o IP uns dos outros. Isso é inerente ao P2P e fica escondido apenas quando o relay TURN é usado.
- O código é a única senha. Quem o tiver entra, a menos que o host tranque a sala.

## 12. Hospedagem e deploy

| | Vercel Hobby | Cloudflare (Worker) |
|---|---|---|
| Papel | Site estático | Sinalização e TURN |
| Limites | 100 GB de tráfego, 1 milhão de requisições, 100 deploys/dia | 100 mil requisições/dia |
| Ao estourar | Espera de até 30 dias | Erro até 00:00 UTC |
| HTTPS | Automático | Automático |
| Restrição | **Só uso pessoal e não comercial** | — |

HTTPS é obrigatório para microfone, câmera e tela; ambos já entregam. Um domínio próprio é opcional, ~US$ 10/ano; o `*.vercel.app` funciona.

**Atenção:** se o Discordia virar produto comercial, o Hobby da Vercel deixa de valer (Pro: US$ 20 por mês por membro). Com ~50 KB por visita (JS + CSS em gzip, medido), 100 GB representam cerca de 2 milhões de carregamentos, mais que a cota de 1 milhão de requisições.

## 13. Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Upload fraco do host ou de quem compartilha tela | Alta | Médio | Bitrate adaptativo; assistir sob demanda |
| Pessoa em NAT restritivo sem TURN | Média | Alto | Configurar o TURN no deploy |
| Queda do host encerra a sala | Média | Médio | Carência de 60 s; aviso claro |
| Sala cheia demais em vídeo | Média | Médio | Limite de 8 na voz, aviso em vídeo |
| Eco sem fone | Média | Baixo | AEC nativo |
| Mudanças de API nos navegadores | Baixa | Médio | Só APIs padronizadas |
| Assets ou marca parecidos demais com o Discord | Baixa | Alto | Identidade própria; nada copiado |

## 14. Evolução para a v2

| Etapa | Adiciona | Muda |
|---|---|---|
| 2.0 | Contas + banco (Postgres/D1) | Identidade real; banimento efetivo |
| 2.1 | Servidores persistentes | O estado do host vai para o backend; a sala sobrevive |
| 2.2 | SFU (LiveKit ou mediasoup) | A malha é trocada por SFU, com simulcast e salas de 50+ |
| 2.3 | App Electron | Áudio de sistema completo |

**LiveKit** é o caminho mais curto, por ter cliente pronto e serviço gerenciado. **mediasoup** dá mais controle, e custa mais operação. A separação entre `RoomHost` (autoridade) e `MediaEngine` (mídia) foi pensada para essa troca: cada parte pode ir para o servidor sem reescrever a interface.

## Resultado da validação

Medido na implementação em 31/10/2026, em uma única máquina, com mídia simulada pelo navegador.

| Item | Resultado |
|---|---|
| Testes de lógica do host | 37 de 37 |
| Testes de ponta a ponta | 58 de 58, em duas execuções seguidas |
| Chromium ↔ Firefox | 10 de 10 repetições |
| Malha de voz com 10 pessoas | 10 processos, cada um com microfone ativo e áudio recebido dos outros 9; a décima primeira é recusada |
| Transmissão com 5 espectadores | 7 processos; o sexto espectador é recusado |
| Bundle | ~55 KB de JS + ~8 KB de CSS em gzip, mais a fonte (~48 KB, baixada uma vez) |
| Build de produção | Funciona sob a CSP do `vercel.json` |
| Worker | Origem, chave do host, carência, fim do código e limite por IP verificados localmente |

**Consumo medido** em um i5-11400F, com mídia simulada, navegador sem interface gráfica, e em % de um núcleo: chat parado 0%, voz 7%, recebendo câmera 10%, enviando câmera 13%, assistindo tela 17%, rádio YouTube 19% (11% silenciado), transmitindo tela 30%. O efeito visual mais caro era o brilho animado de quem fala; removê-lo levou a tela da chamada de 17% para 7%.

**Ainda não validado:** internet real entre redes diferentes, TURN, som e imagem reais, Safari, celulares físicos, áudio de sistema no Windows e consumo de CPU em cada máquina. Os limites de pessoas continuam sendo estimativas até esse teste.

## Fontes

- [Vercel — Hobby plan](https://vercel.com/docs/plans/hobby)
- [Cloudflare — Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare — Realtime TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
- [Cloudflare — TURN pricing](https://developers.cloudflare.com/realtime/pricing/)
- [Cloudflare — Generate TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Chrome — Intensive timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [PeerJS — FAQ](https://peerjs.com/client/faq)
- [PeerJS alternatives in 2026](https://dev.to/alakkadshaw/peerjs-alternatives-in-2026-free-turn-auto-reconnect-and-which-webrtc-library-to-actually-pick-14ad)
- [Trystero no npm](https://npmjs.com/package/trystero)
- [Metered — Open Relay](https://www.metered.ca/tools/openrelay/)
- [getstream — STUN/TURN](https://getstream.io/resources/projects/webrtc/advanced/stun-turn/)
- [Captura de áudio de sistema no navegador](https://dev.to/flo152121063061/i-tried-to-capture-system-audio-in-the-browser-heres-what-i-learned-1f99)
- [Web features — Screen capture](https://web-platform-dx.github.io/web-features-explorer/features/screen-capture/)
- [Svelte vs Solid, tamanhos de bundle](https://arc.dev/employer-blog/svelte-vs-vue-vs-solidjs/)

Versões e datas das bibliotecas: `npm view`, em 31/10/2026.
