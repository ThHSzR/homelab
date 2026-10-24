(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const section = $('kindle-writer');
  if (!section) return;
  const labels = { pendente: 'Na fila', planejando: 'Planejando', escrevendo: 'Escrevendo', revisando: 'Revisando',
    finalizado: 'Finalizado', enviado: 'Enviado', falhou: 'Falhou', online: 'Online', stopped: 'Parado',
    errored: 'Falhou', unknown: 'Sem leitura recente', unmanaged: 'Não registrado' };
  let selected = '', busy = false, logBusy = false;
  let lastData = null, follow = true;
  const make = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const mib = value => Number.isFinite(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MiB' : '—';
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : '—';
  const elapsed = seconds => Number.isFinite(seconds) ? Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' s' : '—';
  function step(value) {
    if (!value) return 'Aguardando tarefa';
    const fixed = { concept: 'Conceito', bible: 'Personagens', 'bible-detail': 'Fatos do crime',
      'bible-canon': 'Bíblia da história', final: 'Título e sinopse finais', export: 'Montando EPUB', complete: 'Concluído' };
    if (fixed[value]) return fixed[value];
    const scene = /^chapter-(\d+)-scene-([12])$/.exec(value);
    if (scene) return 'Capítulo ' + Number(scene[1]) + ' · cena ' + scene[2] + '/2';
    const edited = /^humanize-(\d+)-([12])$/.exec(value);
    if (edited) return 'Edição da prosa · capítulo ' + Number(edited[1]) + ' · cena ' + edited[2] + '/2';
    const stage = /^(plan|review|summary|chapter)-(\d+)$/.exec(value);
    return stage ? ({ plan: 'Plano', review: 'Revisão', summary: 'Resumo', chapter: 'Capítulo salvo' }[stage[1]]) + ' · capítulo ' + Number(stage[2]) : value;
  }
  const line = (label, value) => {
    const item = make('div', null, 'system-line');
    item.append(make('span', label), make('strong', value));
    return item;
  };

  function render(data) {
    lastData = data;
    const book = data.book, active = data.inference, previous = data.lastInference;
    $('kw-updated').textContent = 'Consultado às ' + new Date().toLocaleTimeString('pt-BR');
    $('kw-worker').textContent = 'Worker: ' + (labels[data.worker?.state] || data.worker?.state || 'Desconhecido');
    $('kw-title').textContent = !data.installed ? 'Kindle Writer não instalado' : book?.title || book?.id || 'Nenhum livro na fila';
    $('kw-author').textContent = book?.author || '';
    const hasCover = /^\d{8}-[a-f0-9]{8}-capa\.jpg$/.test(data.cover?.name || '');
    $('kw-cover').hidden = !hasCover;
    $('kw-book-heading').classList.toggle('with-cover', hasCover);
    if (hasCover) {
      const url = '/api/kindle-writer/covers/' + encodeURIComponent(data.cover.name) +
        (Number.isFinite(data.cover.version) ? '?v=' + data.cover.version : '');
      $('kw-cover-image').src = url;
      $('kw-cover-image').alt = 'Capa de ' + (book?.title || '') + ' — ' + (book?.author || '');
      $('kw-cover-download').href = url;
      $('kw-cover-download').download = data.cover.name;
    } else {
      $('kw-cover-image').removeAttribute('src');
      $('kw-cover-download').removeAttribute('href');
    }
    let state = !data.installed ? 'Instale o Kindle Writer no A30 para acompanhar os livros.' : !book ? 'Aguardando um novo livro.' :
      data.paused ? 'Geração pausada' : book.status === 'falhou' ? 'Etapa interrompida após falhas' :
        data.worker?.state === 'stopped' ? 'Worker parado' :
          book.retryAt * 1000 > Date.now() && !active ? 'Aguardando nova tentativa' :
            (labels[book.status] || book.status) + ' · ' + step(book.step);
    if (data.worker?.stale) state += ' · Estado do worker sem leitura recente';
    $('kw-state').textContent = state;
    $('kw-state').className = 'kw-state' + (book?.status === 'falhou' || data.paused ? ' warn' : '');
    const error = $('kw-error');
    error.hidden = !book?.error;
    error.textContent = book?.error || '';
    const p = book?.progress;
    $('kw-progress').value = p?.percent || 0;
    $('kw-progress').setAttribute('aria-valuetext', p ? p.completed + ' de ' + p.total + ' checkpoints salvos' : 'Nenhum livro');
    $('kw-progress-label').textContent = p ? `${p.completed}/${p.total} checkpoints · ${p.percent}%` : 'Sem progresso';
    $('kw-chapters').textContent = p ? `${p.written}/${book.chapters}` : '—';
    $('kw-plans').textContent = p ? `${p.plans}/${book.chapters}` : '—';
    $('kw-scenes').textContent = p ? `${p.scenes}/${book.chapters * 2}` : '—';
    $('kw-inference').textContent = active ? 'Inferência em execução · ' + elapsed(active.elapsedSeconds) :
      data.paused ? 'Inferência pausada' : 'Sem inferência ativa';
    $('kw-inference-detail').textContent = active ? 'Tempo desde a preparação da chamada. A leitura do contexto também pode levar minutos.' :
      'Os checkpoints anteriores permanecem salvos durante pausas e novas tentativas.';
    const profile = data.profile || {};
    $('kw-resources').replaceChildren(
      line('Memória atual da IA', mib(active?.rssMib)),
      line('Pico desta chamada', mib(active?.peakRssMib)),
      line('Limite de memória da IA', profile.rssLimitDisabled ? 'Sem teto configurado' : mib(profile.maxRssMib)),
      line('Reserva mínima do Android', mib(profile.reserveMib)),
      line('Contexto / threads', (active?.context || profile.context || '—') + ' / ' + (active?.threads || profile.threads || '—')),
      line('Última geração', previous?.generationTps != null ? previous.generationTps.toLocaleString('pt-BR') + ' tokens/s' : '—'),
      line('Último pico / duração', previous ? mib(previous.peakRssMib) + ' / ' + elapsed(Math.round(previous.seconds)) : '—'),
      line('Bateria na última chamada', previous?.batteryC != null ? previous.batteryC.toLocaleString('pt-BR') + ' °C' : '—')
    );
    $('kw-model').textContent = profile.model || 'Modelo ainda não informado';
    $('kw-checkpoint').textContent = book ? 'Etapa registrada em ' + date(book.updated) + ' · tentativa ' + (book.attempts || 0) : '';
    $('kw-options').textContent = 'Novos livros: ' + (data.schedule?.enabled ? 'agendamento ativo' : 'agendamento desativado') +
      ' · Envio automático: ' + (data.mail?.enabled && data.mail?.automatic ? 'ativo' : 'desativado');

    const select = $('kw-book');
    const options = data.books || [];
    if ([...select.options].map(o => o.value + o.textContent).join('|') !== options.map(b => b.id + b.id + ' · ' + (labels[b.status] || b.status)).join('|')) {
      select.replaceChildren(...options.map(b => { const o = make('option', b.id + ' · ' + (labels[b.status] || b.status)); o.value = b.id; return o; }));
    }
    select.disabled = !options.length;
    select.value = book?.id || '';
    const artifacts = $('kw-artifacts');
    artifacts.replaceChildren(...(data.artifacts || []).map(file => {
      const a = make('a', file.partial ? '↓ Baixar amostra EPUB' : '↓ Baixar livro EPUB', 'kw-download');
      // Construct fixed same-origin links rather than trusting a URL from disk/API.
      if (/^\d{8}-[a-f0-9]{8}(?:-amostra)?\.epub$/.test(file.name)) {
        a.href = '/api/kindle-writer/books/' + encodeURIComponent(file.name);
        a.setAttribute('download', file.name);
      }
      return a;
    }));
    if (!data.artifacts?.length) artifacts.append(make('p', 'O download aparece aqui quando um EPUB estiver disponível.', 'kw-note'));
  }

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }
  async function update() {
    if (busy) return;
    busy = true;
    const requested = selected;
    try {
      const data = await json('/api/kindle-writer/status' + (requested ? '?book=' + encodeURIComponent(requested) : ''));
      if (requested === selected) render(data);
    }
    catch {
      if (requested !== selected) return;
      $('kw-updated').textContent = 'Monitor indisponível · tentando novamente';
      $('kw-state').textContent = 'Sem leitura recente. Os dados exibidos podem estar desatualizados.';
      $('kw-state').className = 'kw-state warn';
      $('kw-inference').textContent = 'Inferência sem leitura recente';
      // Hide stale downloads and live resource claims after a failed refresh.
      $('kw-artifacts').replaceChildren();
      $('kw-cover').hidden = true;
      $('kw-resources').replaceChildren(line('Leitura atual', 'Indisponível'));
    } finally { busy = false; if (requested !== selected) update(); }
  }
  async function logs() {
    if (logBusy || !$('kw-log-details').open) return;
    logBusy = true;
    const box = $('kw-log-content'), channel = $('kw-log-channel').value, bookId = lastData?.book?.id;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    try {
      const data = await json('/api/kindle-writer/logs?channel=' + channel +
        (bookId ? '&book=' + encodeURIComponent(bookId) : ''));
      if (channel !== $('kw-log-channel').value || bookId !== lastData?.book?.id) return;
      box.textContent = data.text || (channel === 'generation' ? 'Preparando ou lendo o contexto; ainda sem texto gerado.' : 'Nenhum evento registrado.');
      $('kw-log-note').textContent = (channel === 'generation' ?
        (data.active ? 'Inferência atual' : 'Última saída disponível') + ' · ' + step(data.step) + '. Pode conter planejamento em JSON.' : 'Eventos e erros da aplicação.') +
        ' Últimas 120 linhas / 16 KiB · atualizado às ' + new Date().toLocaleTimeString('pt-BR');
      if (atBottom) box.scrollTop = box.scrollHeight;
    } catch {
      $('kw-log-note').textContent = 'Log sem leitura recente. A atualização será tentada novamente.';
    } finally {
      logBusy = false;
      if (channel !== $('kw-log-channel').value || bookId !== lastData?.book?.id) logs();
    }
  }
  $('kw-book').addEventListener('change', async () => { selected = $('kw-book').value; await update(); await logs(); });
  $('kw-refresh').addEventListener('click', async () => { await update(); await logs(); });
  $('refresh').addEventListener('click', update);
  $('kw-log-details').addEventListener('toggle', logs);
  $('kw-log-channel').addEventListener('change', logs);
  $('kw-log-follow').addEventListener('click', () => {
    follow = !follow;
    $('kw-log-follow').textContent = follow ? 'Pausar log' : 'Retomar log';
    $('kw-log-follow').setAttribute('aria-pressed', String(!follow));
    if (follow) logs();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { update(); if (follow) logs(); }
  });
  window.addEventListener('focus', update);
  update();
  setInterval(() => { if (document.visibilityState === 'visible') update(); }, 15000);
  setInterval(() => { if (document.visibilityState === 'visible' && follow) logs(); }, 5000);
})();
