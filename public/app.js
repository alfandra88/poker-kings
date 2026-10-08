/* Poker Kings: hand ranking. Plain DOM, no build step. */
(function () {
  'use strict';

  var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var SUITS = ['♠', '♥', '♦', '♣'];
  var main = document.getElementById('main');
  var tabs = document.querySelectorAll('.tabs button');
  var state = { me: null, token: new URLSearchParams(location.search).get('token'), tab: 'play' };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return el;
  }

  function api(method, url, body) {
    var headers = { 'content-type': 'application/json' };
    if (state.token) headers['x-usernode-token'] = state.token;
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || 'request_failed');
            err.status = res.status;
            err.code = data.error;
            throw err;
          }
          return data;
        });
      });
  }

  function message(err) {
    if (err.code === 'account_required' || err.status === 401) return 'Sign in to Homeroom to save your points.';
    if (err.code === 'room_not_found') return 'No room with that code.';
    if (err.code === 'database_unavailable') return 'The game is starting up. Try again in a moment.';
    if (err.code === 'already_answered' || err.code === 'wrong_round') return 'That hand was already answered.';
    return 'Something went wrong. Try again.';
  }

  function cardEl(card) {
    var suit = card & 3;
    return h('span', { class: 'card' + (suit === 1 || suit === 2 ? ' red' : ''), 'aria-label': RANKS[card >> 2] + ' of ' + ['spades', 'hearts', 'diamonds', 'clubs'][suit] },
      h('span', null, RANKS[card >> 2]), h('span', { 'aria-hidden': 'true' }, SUITS[suit]));
  }

  function cardsEl(hand) {
    return h('div', { class: 'cards' }, hand.map(cardEl));
  }

  function setPoints(total) {
    var el = document.getElementById('points');
    el.hidden = false;
    el.textContent = total + ' points';
  }

  function showState(text, isError) {
    main.replaceChildren(h('p', { class: 'state' + (isError ? ' err' : '') }, text));
  }

  /* ---------- question play (solo and room share this) ---------- */

  // opts: { load(): Promise<question|{finished}>, onFinished(): void, header: Node|null, after(): void }
  function playQuestions(opts) {
    showState('Dealing hands...');
    opts.load().then(function (q) {
      if (q.finished) return opts.onFinished();
      renderQuestion(q, opts);
    }, function (err) { showState(message(err), true); });
  }

  function renderQuestion(q, opts) {
    var picked = [];
    var busy = false;
    var isOrder = q.kind === 'order';
    var handBoxes = q.hands.map(function (hand, i) {
      var tag = isOrder ? 'button' : 'div';
      var box = h(tag, { class: 'hand', type: isOrder ? 'button' : null },
        h('div', { class: 'label' }, h('span', null, isOrder ? 'Hand ' + (i + 1) : 'Hand ' + 'AB'[i]), h('span', { class: 'slot' })),
        cardsEl(hand));
      if (isOrder) {
        box.addEventListener('click', function () {
          if (busy || picked.indexOf(i) !== -1) return;
          picked.push(i);
          refresh();
        });
      }
      return box;
    });
    var submit = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: function () { send(picked.slice()); } }, 'Check order');
    var reset = h('button', { class: 'btn', type: 'button', onclick: function () { picked = []; refresh(); } }, 'Start over');
    var status = h('p', { class: 'muted' });

    function refresh() {
      handBoxes.forEach(function (box, i) {
        var pos = picked.indexOf(i);
        box.classList.toggle('picked', pos !== -1);
        var slot = box.querySelector('.slot');
        slot.replaceChildren(pos === -1 ? '' : h('span', { class: 'order-badge' }, String(pos + 1)));
      });
      submit.disabled = busy || picked.length !== q.hands.length;
      reset.disabled = busy || picked.length === 0;
    }

    function send(answer) {
      if (busy) return;
      busy = true;
      refresh();
      status.textContent = '';
      api('POST', '/api/answer', { token: q.token, answer: answer }).then(function (r) {
        setPoints(r.totalPoints);
        renderResult(q, answer, r, opts);
      }, function (err) {
        busy = false;
        refresh();
        status.className = 'err';
        status.textContent = message(err);
      });
    }

    var controls;
    if (isOrder) {
      controls = h('div', { class: 'row' }, submit, reset);
    } else {
      controls = h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: function () { send('a'); } }, 'Hand A wins'),
        h('button', { class: 'btn', type: 'button', onclick: function () { send('b'); } }, 'Hand B wins'),
        h('button', { class: 'btn', type: 'button', onclick: function () { send('tie'); } }, 'Tie'));
    }
    main.replaceChildren(
      opts.header,
      h('h2', null, isOrder ? 'Order the hands, strongest first' : 'Which hand wins?'),
      h('p', { class: 'muted' }, isOrder ? 'Tap the hands from strongest to weakest.' : 'Compare the two five-card hands.'),
      h('div', null, handBoxes), controls, status);
    refresh();
  }

  function renderResult(q, answer, r, opts) {
    var boxes = q.hands.map(function (hand, i) {
      var rank = r.solution === 'tie' ? -1 : (q.kind === 'order' ? r.solution.indexOf(i) : ('ab'[i] === r.solution ? 0 : 1));
      var win = q.kind === 'order' ? rank === 0 : rank === 0 || r.solution === 'tie';
      return h('div', { class: 'hand' + (win ? ' win' : '') },
        h('div', { class: 'label' },
          h('span', null, (q.kind === 'order' ? 'Hand ' + (i + 1) : 'Hand ' + 'AB'[i]) + (q.kind === 'order' ? ', ranked ' + (rank + 1) : '')),
          h('span', null, r.hands[i].name + ', ' + r.hands[i].detail)),
        cardsEl(hand));
    });
    var summary = r.correct
      ? 'Correct. +' + r.points + ' points' + (r.bonus ? ' (' + r.bonus + ' streak bonus)' : '') + '.'
      : 'Not this time. The strongest hand is ranked first below.';
    var shown = boxes;
    if (q.kind === 'order') {
      shown = r.solution.map(function (idx) { return boxes[idx]; });
    }
    var next = h('button', { class: 'btn primary', type: 'button', onclick: function () { opts.after(); } }, opts.nextLabel || 'Next hand');
    main.replaceChildren(
      opts.header,
      h('div', { class: 'result ' + (r.correct ? 'ok' : 'no') },
        h('h2', null, r.correct ? 'Correct' : 'Not quite'),
        h('p', null, summary),
        r.streak > 1 ? h('p', { class: 'muted' }, r.streak + ' correct in a row') : null),
      h('div', null, shown),
      h('div', { class: 'row' }, next));
    next.focus();
  }

  /* ---------- tabs ---------- */

  function viewPlay() {
    var kind = state.kind || 'compare';
    function mode(k, label) {
      return h('button', {
        class: 'btn' + (kind === k ? ' primary' : ''), type: 'button',
        onclick: function () { state.kind = k; viewPlay(); },
      }, label);
    }
    var header = h('div', null,
      h('div', { class: 'modes' }, mode('compare', 'Which hand wins?'), mode('order', 'Order the hands')));
    var start = function () {
      playQuestions({
        header: header,
        load: function () { return api('GET', '/api/question?kind=' + kind); },
        after: start,
      });
    };
    start();
  }

  function viewLeaders() {
    showState('Loading the leaderboard...');
    api('GET', '/api/leaderboard').then(function (data) {
      if (!data.entries.length) {
        main.replaceChildren(h('h2', null, 'Leaderboard'), h('p', { class: 'state' }, 'No points yet. Answer a hand to get on the board.'),
          h('button', { class: 'btn primary', type: 'button', onclick: function () { go('play'); } }, 'Play now'));
        return;
      }
      main.replaceChildren(h('h2', null, 'Leaderboard'), entryList(data.entries, data.me));
    }, function (err) { showState(message(err), true); });
  }

  function entryList(entries, me) {
    return h('ol', { class: 'list' }, entries.map(function (e, i) {
      return h('li', { class: e.userId === me ? 'me' : '' },
        h('span', null, (i + 1) + '. ' + e.username),
        h('span', { class: 'pts' }, e.points + ' points, ' + e.correct + '/' + e.answered + ' correct'));
    }));
  }

  function viewRooms() {
    var input = h('input', { class: 'code', type: 'text', maxlength: '6', placeholder: 'Room code', 'aria-label': 'Room code', autocomplete: 'off' });
    var err = h('p', { class: 'err' });
    function open(code) { history.pushState(null, '', '/room/' + code); viewRoom(code); }
    function fail(e) { err.textContent = message(e); }
    main.replaceChildren(
      h('h2', null, 'Rooms'),
      h('p', { class: 'muted' }, 'Everyone in a room gets the same ten hands. Most points wins.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: function () { api('POST', '/api/rooms').then(function (r) { open(r.code); }, fail); } }, 'Create a room')),
      h('div', { class: 'row' }, input,
        h('button', { class: 'btn', type: 'button', onclick: function () {
          var code = input.value.trim().toUpperCase();
          if (code.length !== 6) { err.textContent = 'Room codes have 6 characters.'; return; }
          api('POST', '/api/rooms/' + code + '/join').then(function () { open(code); }, fail);
        } }, 'Join room')),
      err);
  }

  function viewRoom(code) {
    state.tab = 'rooms';
    markTab();
    showState('Opening room...');
    api('GET', '/api/rooms/' + code).then(function (room) {
      var header = h('div', null,
        h('h2', null, 'Room ' + room.code),
        h('p', { class: 'muted' }, 'Hosted by ' + room.host + '. Share this code or link so others can join.'));
      var join = room.joined || !state.me
        ? Promise.resolve()
        : api('POST', '/api/rooms/' + code + '/join').catch(function () {});
      join.then(function () {
        var step = function () {
          playQuestions({
            header: h('div', null, header, h('p', { class: 'muted' }, 'Round ' + Math.min(room.answered + 1, room.rounds) + ' of ' + room.rounds)),
            nextLabel: 'Next round',
            load: function () { return api('GET', '/api/rooms/' + code + '/question'); },
            after: function () { room.answered += 1; step(); },
            onFinished: function () { roomBoard(code, header); },
          });
        };
        if (room.answered >= room.rounds) roomBoard(code, header);
        else step();
      });
    }, function (err) { showState(message(err), true); });
  }

  function roomBoard(code, header) {
    api('GET', '/api/rooms/' + code).then(function (room) {
      main.replaceChildren(header, h('h3', null, 'Room standings'), entryList(room.entries, room.me),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { roomBoard(code, header); } }, 'Refresh standings')));
    }, function (err) { showState(message(err), true); });
  }

  function markTab() {
    tabs.forEach(function (b) {
      if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function go(tab) {
    state.tab = tab;
    markTab();
    if (location.pathname !== '/') history.pushState(null, '', '/');
    if (tab === 'play') viewPlay();
    else if (tab === 'rooms') viewRooms();
    else viewLeaders();
  }

  tabs.forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.tab); }); });

  api('GET', '/api/me').then(function (me) {
    state.me = me.user;
    document.getElementById('who').textContent = me.user ? me.user.username : 'Not signed in';
  }, function () {
    document.getElementById('who').textContent = 'Not signed in';
  }).then(function () {
    var m = /^\/room\/([A-Za-z0-9]{6})$/.exec(location.pathname);
    if (m) viewRoom(m[1].toUpperCase());
    else viewPlay();
  });
})();
