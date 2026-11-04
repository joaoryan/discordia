// Mini janela: mostra a chamada e repassa cliques. Sem acesso a nada além de window.mini.
const $ = (id) => document.getElementById(id);
const MAX_FACES = 5;
const ICONS = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>',
};

let expanded = false;
try {
  expanded = localStorage.getItem('discordia.mini.expanded') === '1';
} catch {
  // Sem armazenamento: começa compacta.
}

function setExpanded(next) {
  expanded = next;
  $('card').className = expanded ? 'expanded' : 'compact';
  $('expand').innerHTML = expanded ? ICONS.collapse : ICONS.expand;
  $('expand').title = expanded ? 'Recolher' : 'Expandir';
  $('expand').setAttribute('aria-label', expanded ? 'Recolher' : 'Expandir');
  try {
    localStorage.setItem('discordia.mini.expanded', expanded ? '1' : '0');
  } catch {
    // idem
  }
  fit();
}

// A janela acompanha o tamanho do conteúdo; o processo principal mantém a borda direita no lugar.
function fit() {
  const box = $('card').getBoundingClientRect();
  window.mini.resize(Math.ceil(box.width) + 4, Math.ceil(box.height) + 4);
}
new ResizeObserver(fit).observe($('card'));

$('expand').addEventListener('click', () => setExpanded(!expanded));
for (const action of ['mute', 'deafen', 'leave', 'open']) {
  $(action).addEventListener('click', () => window.mini.action(action));
}
// Duplo clique na pílula abre o app.
$('faces').addEventListener('dblclick', () => window.mini.action('open'));

function avatar(person) {
  const av = document.createElement('span');
  av.className = 'av';
  av.style.background = person.color;
  av.textContent = person.name.slice(0, 2).toUpperCase();
  return av;
}

window.mini.onCall((call) => {
  if (!call) return;
  $('channel').textContent = call.channel;
  $('mute').classList.toggle('on', call.muted);
  $('mute').innerHTML = call.muted ? ICONS.micOff : ICONS.mic;
  $('mute').title = call.muted ? 'Ativar microfone' : 'Silenciar microfone';
  $('deafen').classList.toggle('on', call.deafened);
  $('deafen').textContent = call.deafened ? 'Ouvir' : 'Ensurdecer';

  // Quem fala aparece primeiro na pílula.
  const ordered = [...call.people].sort((a, b) => Number(b.speaking) - Number(a.speaking));
  const faces = ordered.slice(0, MAX_FACES).map((person) => {
    const li = document.createElement('li');
    li.classList.toggle('speaking', person.speaking);
    li.title = person.self ? `${person.name} (você)` : person.name;
    li.append(avatar(person));
    return li;
  });
  if (ordered.length > MAX_FACES) {
    const li = document.createElement('li');
    const more = document.createElement('span');
    more.className = 'av more';
    more.textContent = `+${ordered.length - MAX_FACES}`;
    li.append(more);
    faces.push(li);
  }
  $('faces').replaceChildren(...faces);

  $('people').replaceChildren(
    ...call.people.map((person) => {
      const li = document.createElement('li');
      li.classList.toggle('speaking', person.speaking);
      const name = document.createElement('span');
      name.textContent = person.self ? `${person.name} (você)` : person.name;
      const status = document.createElement('small');
      status.textContent = person.speaking ? 'falando' : '';
      li.append(avatar(person), name, status);
      return li;
    }),
  );
});

setExpanded(expanded);
