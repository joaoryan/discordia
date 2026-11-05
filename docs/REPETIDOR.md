# Repetidor entre amigos

Projeto para que um participante bem conectado repasse a voz entre dois que não se alcançam, deixando o TURN como último recurso.

## 1. O problema

Duas casas na mesma operadora com CGNAT (no nosso caso, a SBS-NET) não se alcançam direto, porque o equipamento da operadora não faz *hairpinning*. Hoje esse par só conecta pelo TURN.

| Caminho | Atraso extra medido | Cota |
|---|---|---|
| Direto | 0 | Não gasta |
| ExpressTURN grátis (Europa) | ~200 ms de ida e volta até o servidor | 1.000 GB/mês |
| Metered (perto) | ~6 ms até o servidor | 500 MB/mês, e recusando relay em 05/11 |
| **Amigo de outra operadora no Brasil** | ~20–60 ms (estimado) | **Não gasta** |

O ganho principal é **qualidade**: o atraso cai de ~200 ms para algumas dezenas. A economia de cota vem junto.

## 2. Por que é barato de fazer aqui

A voz já é uma malha: quem está num canal de voz tem uma conexão com cada pessoa desse canal (`syncMesh` em `src/lib/session.svelte.ts`). Se A e B estão bloqueados e C está no mesmo canal, **C já recebe o áudio dos dois**. Repassar é só C adicionar a trilha que recebeu de A na conexão que já tem com B, e vice-versa. Não há conexão nova, e o navegador recodifica sozinho.

O host da sala já repassa a sinalização da malha (`case 'rtc'` em `src/lib/host.ts`) e já sabe quem está em cada canal. Ele vira o **coordenador** natural.

## 3. Termos

- **Par**: duas pessoas do mesmo canal de voz.
- **Caminho do par**: `direto`, `via <repetidor>` ou `turn`.
- **Repetidor**: participante do mesmo canal que repassa a voz de um par.
- **Coordenador**: o `RoomHost`, que guarda o mapa e decide os caminhos.

## 4. Fluxo de um par

```
entra no canal
   │
   ├─ tenta direto, SÓ com STUN (não gasta cota)
   │      └─ IP público igual (ou mesmo /24) e nada ligou em 2,5 s? → "provável bloqueio"
   │
   ├─ provável bloqueio + há repetidor  → liga o repetidor JÁ, em paralelo
   │
   ├─ direto conectou       → caminho = direto; desliga o repetidor, se houver
   ├─ direto falhou (6 s)   → pede repetidor ao coordenador
   │      ├─ há candidato   → caminho = via repetidor
   │      └─ não há         → TURN no modo econômico
   │
   └─ repetidor saiu → reserva → senão TURN (o mesmo RTCPeerConnection: setConfiguration + restartIce)
```

### 4.1 Tentar direto sem TURN

Hoje cada `MeshPeer` nasce com a lista completa de servidores, TURN incluso. A mudança:

- A lista de ICE é dividida em `stun` e `turn` (`src/lib/signaling.ts`).
- O `MeshPeer` nasce só com `stun`.
- Quando o coordenador manda escalar, o par recebe a lista completa com `pc.setConfiguration()` e reinicia com `pc.restartIce()`, sem recriar a conexão.

### 4.2 Prever o bloqueio

Os candidatos `srflx` trazem o IP público de cada lado e já passam pela sinalização. Se os dois têm o mesmo IP público, há dois casos:

- **Mesma casa**: o candidato local (mDNS) conecta em menos de 1 s.
- **Mesma operadora com CGNAT**: nada conecta.

Regra: IP público igual, ou do mesmo bloco /24 (a operadora pode sair por IPs vizinhos), e nada conectado em 2,5 s significa "provável bloqueio". A previsão não cancela a tentativa direta: se ela conectar depois, o par volta para o direto e o repetidor é liberado.

### 4.3 Memória

O coordenador guarda os pares bloqueados pela dupla de IPs públicos durante a sala. Quem reentra (F5, troca de canal) vai direto para o repetidor. Depois, isso pode virar `localStorage` de cada participante.

## 5. Mapa e escolha do repetidor

Cada participante reporta ao coordenador, numa mensagem nova `{ t: 'links' }`, a cada mudança de caminho e, para atualizar o atraso, a cada 15 s:

| Campo | Origem |
|---|---|
| Com quem tem caminho direto | `connectionState` de cada `MeshPeer` com candidato não-relay |
| RTT de cada um | `candidate-pair.currentRoundTripTime` (já lido em `stats()`) |
| Upload disponível | `candidate-pair.availableOutgoingBitrate` |
| Plataforma | App de computador, navegador no PC ou celular |

### Candidato válido para o par A↔B

- está no mesmo canal de voz;
- tem caminho **direto** com A **e** com B;
- está com menos de `MAX_PARES` pares (4, para começar);
- não desligou a opção "Ajudar a conectar".

### Nota (menor é melhor)

```
nota = RTT(A,R) + RTT(R,B)
     + 40 ms × pares que R já repassa
     + 80 ms se R está no celular
     + 60 ms se R entrou há menos de 2 min
     + 100 ms por queda de R nos últimos 10 min
```

O de menor nota é o **repetidor**; o segundo, a **reserva**. A escolha fica numa função pura (`src/lib/relayPlan.ts`) que recebe o mapa e devolve os caminhos, para poder ser testada sozinha.

Quando chega alguém melhor, o coordenador **só troca se a nota cair mais de 30%**. Isso evita que o áudio fique pulando de um repetidor para outro.

## 6. Como o repasse funciona

Mensagens novas, sempre enviadas pelo coordenador:

```ts
// Para o repetidor
{ t: 'relay', role: 'relay', pair: [a, b] }        // começa
{ t: 'relay', role: 'relay', pair: [a, b], stop: true }

// Para A e B
{ t: 'relay', role: 'end', via: r, peer: b }       // o áudio de b chega por r
{ t: 'relay', role: 'end', via: null, peer: b }    // voltou ao direto ou ao TURN
```

**No repetidor R:** pega a trilha de áudio recebida de A e faz `addTrack` na conexão com B, num `MediaStream` próprio. Depois avisa B, pela sinalização da malha, que aquele stream é o áudio de A: `{ relayed: { stream, origin: a } }`. O mesmo vale no sentido inverso.

**Em B:** o stream marcado é tratado como áudio de A. Volume por pessoa, indicador de fala e mudo usam o `origin`. Se o direto com A conectar, B toca só o direto e pede ao coordenador para encerrar o repasse. Assim **nunca há áudio duplicado**.

**Mudo e ensurdecer:** A desabilita a própria trilha, e o repetidor repassa silêncio. Nada muda.

## 7. TURN econômico

Quando o caminho de um par é `turn`:

| O quê | Ajuste |
|---|---|
| Voz | `maxBitrate` de 24 kbps no sender de áudio desse par, com DTX (`usedtx=1`) |
| Câmera | Modo leve (`cameraEncoding(..., lite)`) e pausada por padrão nesse par (`requestVideo(false)`) |
| Tela | Aviso antes de transmitir: "X assiste pelo relay e gasta a cota" |
| Rádio | 64 kbps em vez de 128 kbps |
| Entrar na sala | Histórico **sem os dados dos anexos**; cada anexo é pedido sob demanda. Hoje o `welcome` manda até 32 MB |

## 8. Mensagens (fase 2)

O chat e os avisos vão pela conexão de dados com o host da sala (`Link`). Quando ela precisa de TURN, o gasto é pequeno, **exceto na entrada**, por causa dos anexos do histórico. O item de entrar na sala da seção 7 resolve a maior parte. A ponte de mensagens por outro usuário fica para depois, porque tem um problema de partida: o convidado ainda não conhece ninguém da sala quando tenta entrar.

## 9. Configurações e transparência

- **Ajudar a conectar quem está bloqueado**: ligada por padrão, com limite de `MAX_PARES`.
- **Painel de Métricas**: cada pessoa mostra `Direto`, `Via Fulano` ou `Via TURN`. Quem está repassando vê "Você está ajudando N pares".

## 10. Privacidade

O repetidor ouve o que repassa. Por isso, na fase 1, ele precisa estar **no mesmo canal de voz**, onde já ouve as duas pessoas de qualquer forma. Repetidores fora do canal só entram com a criptografia de ponta a ponta da fase 4.

## 11. O que já está implementado

| Parte | Onde |
|---|---|
| Escolha do repetidor (nota, carga, reserva, troca só acima de 30%) | `src/lib/relayPlan.ts`, testada em `tests/relayPlan.test.ts` |
| Host como coordenador: mapa, plano, avisos só quando muda | `src/lib/host.ts` (`onLinks`, `replan`) |
| Tentativa direta só com STUN, previsão por IP público igual ou do mesmo bloco /24, desistência em 6 s | `MeshPeer` em `src/lib/media.ts` |
| Repasse da voz e do rádio, sem áudio em dobro, validado pelo plano | `MediaEngine.refreshRelays` e `refreshStreams` |
| TURN só no último caso, na mesma conexão (`setConfiguration` + `restartIce`) | `MeshPeer.escalate` |
| Par que estava no TURN para de enviar mídia quando um repetidor assume | `MediaEngine.setSilenced` |
| TURN econômico: voz a 24 kbps com DTX, rádio a 64 kbps, câmera leve, tela até 1 Mbps | `MediaEngine.applyBitrates` |
| Histórico e anexos novos sem os dados para quem entrou pelo TURN, com "Carregar" sob demanda | `host.ts` (`leanMessage`) e `Message.svelte` |
| Opção "Ajudar a conectar" e caminho de cada pessoa no painel de Métricas | `SettingsModal.svelte`, `MetricsPanel.svelte` |
| Bloqueio simulado para testes (`localStorage['discordia.testBlock']`) | `e2e/18-repetidor.spec.ts` |

### Limites da versão atual

- **Câmera e tela não passam pelo repetidor.** Entre duas pessoas repassadas, só a voz e o rádio chegam. Isso fica para a fase 3.
- **A conexão de cada convidado com o host da sala** continua usando o TURN quando é bloqueada. Ela leva pouco depois da entrada, porque os anexos já vão sob demanda.
- **A previsão depende do STUN:** sem o IP público dos dois lados, o par espera os 6 s antes de chamar o repetidor.

## 12. Fases

| Fase | Conteúdo | Pronta quando |
|---|---|---|
| **0. Validar** | Painel de Métricas mostrando o caminho e o IP público de cada par. Teste real com um amigo de fora | Confirmado que o amigo de fora fala **direto** com a SBS-NET |
| **1. Repetidor de voz** | Seções 4 a 6, mais o modo de teste da seção 12 | E2E com bloqueio simulado passando, e teste real sem TURN |
| **2. Economia** | Seção 7, com a prioridade para o histórico sem anexos | Entrar na sala pelo TURN custando menos de 1 MB |
| **3. Repasse sem recodificar** | Encoded Transforms: o repetidor copia quadros codificados. Abre câmera e tela pelo repetidor | Prova de conceito em Chrome e Firefox |
| **4. Ajuda fora da chamada** | Criptografia de quadros com chave do canal, e o app de computador como ajudante em segundo plano | Repetidor fora do canal sem conseguir ouvir |

## 13. Testes

- **Unitários**: `relayPlan.ts` (escolha, reserva, limite de pares, troca só acima de 30%).
- **E2E com bloqueio simulado**: uma flag de teste (`?block=a,b` ou `localStorage`) descarta os candidatos ICE entre dois participantes. Com o Worker local sem TURN, o teste verifica que:
  - A e B se ouvem via C (`bytesReceived` crescendo no stream marcado);
  - quando C sai, o par vai para a reserva;
  - sem reserva, o par mostra "sem caminho", porque no teste não há TURN.
- **Real**: duas casas da SBS-NET mais um amigo de fora, olhando o painel de Métricas.

## 14. Riscos

| Risco | Mitigação |
|---|---|
| Os amigos de fora também estão bloqueados com a SBS-NET | A fase 0 descobre antes de construir |
| O repetidor sai no meio da fala | Reserva já escolhida; troca em menos de 1 s |
| Atraso de recodificação (~20 ms) | Aceitável para voz; a fase 3 elimina |
| Upload ou CPU fraca do repetidor | Nota penaliza celular e carga; limite de pares |
| Áudio duplicado na troca de caminho | B toca uma única origem por pessoa |
| Mudança na malha quebra o que já funciona | O repetidor só age em pares marcados; os outros seguem iguais |

## 15. Onde paramos (05/11/2026)

### Situação do código

- **Nada foi commitado ainda.** Tudo está no branch local `repetidor`, criado a partir do `main`.
- O branch tem três mudanças diferentes, que devem virar PRs separados:
  1. **Worker:** fechado ao domínio (`ALLOWED_ORIGINS`) e ExpressTURN como TURN principal (`worker/src/index.ts`, `worker/wrangler.toml`, `README.md`, `scripts/turn-check.mjs`). **Já está publicado na Cloudflare**, mas só existe neste PC: se alguém publicar o Worker a partir do `main`, ele volta a ficar aberto e perde o ExpressTURN.
  2. **Testes e2e:** o fechamento das pessoas virou fixture (`e2e/helpers.ts` e os imports dos specs). Veja abaixo.
  3. **Repetidor:** todo o resto (seção 11).

### Testes

| Suíte | Resultado em 05/11 |
|---|---|
| Lógica (`npx vitest run`) | 69 de 69 |
| Tipos (`npm run check`) | Sem erros |
| Suíte completa (`npx playwright test --project=chromium`) | **68 de 68** |
| Produção (`--project=producao`) | 1 de 1 |

**A falha instável foi resolvida.** O `test.afterEach` de `e2e/helpers.ts`, que fecha as pessoas de cada teste, ficava no nível do módulo. Como o módulo é avaliado uma vez por worker, o gancho só valia para o primeiro arquivo que o importava. Nos outros, as chamadas de voz ficavam abertas até o Chromium esgotar as capturas de áudio por volta do 54º teste (`NotReadableError`). Por isso a falha pulava entre `4-voz:72` e `5-video:45`, inclusive no `main`. Agora o `test` vem de `./helpers` com uma fixture automática, que fecha as pessoas e todos os contextos do navegador compartilhado depois de cada teste.

Os navegadores próprios de `9-controles` e `10-radio` foram criados para driblar esse mesmo problema e podem voltar ao navegador compartilhado depois.

### TURN

| Servidor | Situação em 04/11 |
|---|---|
| ExpressTURN (`free.expressturn.com:3478`) | ✅ Relay testado em UDP e TCP. Fica na Europa (~200 ms) |
| Metered | ❌ Recusa o relay com "400 TURN allocate error". Falta olhar o painel: credencial ativa? Os 500 MB acabaram? |

Para testar os servidores de novo: `node scripts/turn-check.mjs`. Ele pede um relay de verdade a cada servidor que o Worker entrega ao site, sem mostrar as credenciais.

### Para terminar

1. ~~Resolver a falha da suíte completa.~~ Feito em 05/11.
2. Commits e PRs: Worker, testes e2e, repetidor.
3. Depois do merge e da publicação na Vercel: **teste real** (fase 0) com duas casas da SBS-NET e um amigo de fora no mesmo canal de voz. No painel de Métricas, o amigo da SBS-NET deve aparecer **via <amigo de fora>**.
4. Ver o problema da Metered no painel.
5. Depois: fases 3 (câmera e tela pelo repetidor) e 4 (ajuda fora da chamada).

