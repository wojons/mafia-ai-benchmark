/* Static-site behaviours: leaderboard sorting + run replay. No network calls. */
(function () {
  'use strict';

  // ------------------------------------------------ leaderboard sorting ---
  var board = document.getElementById('board');
  if (board && document.querySelector('#board th.sortable')) {
    var headers = board.querySelectorAll('th.sortable');
    var rows = function () { return Array.prototype.slice.call(board.querySelectorAll('tbody tr')); };
    var sortState = { idx: null, dir: 1 };
    headers.forEach(function (th, i) {
      th.addEventListener('click', function () {
        var dir = (sortState.idx === i) ? -sortState.dir : 1;
        sortState = { idx: i, dir: dir };
        headers.forEach(function (h) { h.classList.remove('sort-asc', 'sort-desc'); });
        th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
        var body = board.querySelector('tbody');
        rows().sort(function (a, b) {
          var av = parseFloat(a.cells[i].getAttribute('data-v'));
          var bv = parseFloat(b.cells[i].getAttribute('data-v'));
          if (isNaN(av)) av = -Infinity;
          if (isNaN(bv)) bv = -Infinity;
          var cmp = (av === bv)
            ? String(a.cells[0].textContent).localeCompare(String(b.cells[0].textContent))
            : av - bv;
          return cmp * dir;
        }).forEach(function (tr) { body.appendChild(tr); });
      });
    });
  }

  // ------------------------------------------------------ run replay -----
  var dataEl = document.getElementById('run-data');
  if (!dataEl) return;
  var payload = JSON.parse(dataEl.textContent);
  var stages = payload.stages || [];
  var names = payload.names || {};

  function fmtTime(ts) { return (ts || '').slice(11, 19); }

  function player(pid, fallback) {
    if (pid && names[pid]) return names[pid];
    if (fallback) return fallback;
    return pid || '?';
  }

  function describe(ev) {
    var d = ev.data || {};
    var who = player(ev.actor_id, d.playerName);
    var t = ev.type;
    if (t === 'AGENT_SAYS_BROADCASTED') return [who + ' says:', d.says];
    if (t === 'VOTE_CAST') return [who + ' votes for ' + (d.targetName || player(d.targetId)) + ':', d.says];
    if (t === 'NIGHT_ACTION_SUBMITTED') {
      if (d.result) return [who + ' investigates ' + (d.targetName || d.targetId) + ' → ' + d.result, d.reason];
      if (who === '?') return ['Mafia night action → ' + (d.targetName || d.targetId), d.reason];
      return [who + ' night action → ' + (d.targetName || d.targetId), d.reason];
    }
    if (t === 'MORNING_REVEAL') {
      var deaths = (d.deaths || []).map(function (x) { return x.name; }).join(', ');
      return [deaths ? 'Morning reveal — dead: ' + deaths : 'Morning reveal — nobody died', null];
    }
    if (t === 'PLAYER_LYNCHED') {
      var lyn = (d.deaths || [])[0];
      return [lyn ? ('Lynched: ' + lyn.name + ' — role ' + (lyn.role || '?')) : 'Player lynched', null];
    }
    if (t === 'PHASE_CHANGED') return ['Phase → ' + (d.phase || '(setup)') + (d.aliveCount != null ? ' · alive ' + d.aliveCount : ''), null];
    if (t === 'GAME_ENDED') return ['Game over — winner: ' + d.winner + ' (mafia alive ' + d.mafiaAlive + ', town alive ' + d.townAlive + ')', null];
    if (t === 'GAME_STARTED') return ['Game started with ' + d.playerCount + ' players', null];
    if (t === 'ROLES_ASSIGNED') return ['Roles assigned to ' + ((d.assignments || []).length) + ' players', null];
    if (t === 'AGENT_THINK_STARTED' || t === 'AGENT_THINK_COMPLETED') {
      return [who + ' thinks (day ' + (ev.metadata ? ev.metadata.dayNumber : '?') + ')', d.think];
    }
    if (t === 'GAME_CREATED' && d.legacyType === 'ABSTAIN') {
      return [who + ' abstains from voting', d.says];
    }
    var bits = Object.keys(d).filter(function (k) {
      return typeof d[k] === 'string' || typeof d[k] === 'number' || typeof d[k] === 'boolean';
    }).slice(0, 5).map(function (k) { return k + '=' + d[k]; });
    return [t.replace(/_/g, ' ').toLowerCase() + (bits.length ? ' — ' + bits.join(', ') : ''), d.think || null];
  }

  function eventNode(ev, withTime) {
    var wrap = document.createElement('div');
    wrap.className = 'event';
    var line = document.createElement('div');
    var meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = (withTime ? fmtTime(ev.timestamp) + ' ' : '') + '#' + (ev.metadata ? ev.metadata.sequence : '');
    line.appendChild(meta);
    var badge = document.createElement('span');
    badge.className = 'badge' + (ev.visibility === 'PRIVATE' ? ' private' : ev.visibility === 'ADMIN' ? ' admin' : '');
    badge.textContent = ev.type.replace(/_/g, ' ').toLowerCase() + (ev.visibility && ev.visibility !== 'PUBLIC' ? ' · ' + ev.visibility.toLowerCase() : '');
    line.appendChild(badge);
    var desc = describe(ev);
    var text = document.createElement('span');
    text.className = 'death';
    text.textContent = desc[0];
    line.appendChild(text);
    wrap.appendChild(line);
    if (desc[1]) {
      var q = document.createElement('div');
      q.className = 'says';
      var qm = document.createElement('span');
      qm.className = 'q';
      qm.textContent = 'SAYS: ';
      q.appendChild(qm);
      q.appendChild(document.createTextNode(desc[1]));
      wrap.appendChild(q);
    }
    var think = (ev.data || {}).think;
    if (think) {
      var th = document.createElement('div');
      th.className = 'think';
      th.textContent = 'THINK: ' + think;
      wrap.appendChild(th);
    }
    return wrap;
  }

  var stageEl = document.getElementById('stage');
  var labelEl = document.getElementById('stage-label');
  var timeline = document.getElementById('timeline');
  var allEvents = document.getElementById('all-events');
  var prevBtn = document.getElementById('prev');
  var nextBtn = document.getElementById('next');
  var thinkBox = document.getElementById('show-think');
  var cur = 0;

  // full event log (always rendered; THINK follows the toggle)
  stages.forEach(function (s) {
    s.events.forEach(function (ev) {
      allEvents.appendChild(eventNode(ev, true));
    });
  });

  stages.forEach(function (s, i) {
    var li = document.createElement('li');
    li.textContent = s.label + ' (' + s.events.length + ')';
    li.addEventListener('click', function () { show(i); });
    timeline.appendChild(li);
  });

  function show(i) {
    cur = Math.max(0, Math.min(stages.length - 1, i));
    var s = stages[cur];
    stageEl.textContent = '';
    var head = document.createElement('h3');
    head.textContent = s.label;
    stageEl.appendChild(head);
    s.events.forEach(function (ev) { stageEl.appendChild(eventNode(ev, true)); });
    labelEl.textContent = 'Stage ' + (cur + 1) + '/' + stages.length;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === stages.length - 1;
    Array.prototype.forEach.call(timeline.children, function (li, j) {
      li.classList.toggle('current', j === cur);
      if (j === cur && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    });
  }

  prevBtn.addEventListener('click', function () { show(cur - 1); });
  nextBtn.addEventListener('click', function () { show(cur + 1); });
  thinkBox.addEventListener('change', function () {
    document.body.classList.toggle('show-think', thinkBox.checked);
  });
  show(0);
})();
