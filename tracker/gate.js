// Access gate for the ball tracker.
//
// This file and index.html are the only tracker files on the website. They
// hold no tracking code. After Google sign-in they check Firestore:
//   trackerUsers/{email}     people the owner has approved
//   trackerRequests/{email}  people waiting for approval
//   trackerApp/current       the app itself (HTML, CSS and modules)
// Firestore rules only let approved people read trackerApp, so the app's code
// is never sent to anyone else.
(function () {
  var auth = firebase.auth(), db = firebase.firestore();
  var gate = document.getElementById('gate'), body = document.getElementById('gate-body');
  var unsubs = [], appLoaded = false, me = null, isAdmin = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stop() { unsubs.forEach(function (u) { try { u(); } catch (e) { /* already closed */ } }); unsubs = []; }
  function show(html, wide) { gate.hidden = false; body.className = 'gate-col' + (wide ? ' wide' : ''); body.innerHTML = html; }
  function whoLine() { return me ? '<p class="who">' + esc(me.email) + ' · <button class="glink" id="g-out">Sign out</button></p>' : ''; }
  function wireOut() { var b = document.getElementById('g-out'); if (b) b.onclick = function () { auth.signOut(); }; }

  // ---------------------------------------------------------------- sign-in
  function showSignIn(msg) {
    show('<h1>Ball tracker</h1><p>This is a private app. Sign in with the Google account the owner has approved.</p>'
      + (msg ? '<p class="err">' + esc(msg) + '</p>' : '')
      + '<button class="gbtn primary block" id="g-in">Sign in with Google</button>');
    document.getElementById('g-in').onclick = function () {
      var p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      auth.signInWithPopup(p).catch(function (err) {
        if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
        showSignIn('Sign-in did not complete. Try again.');
      });
    };
  }

  auth.onAuthStateChanged(function (user) {
    stop();
    if (appLoaded) { location.reload(); return; }      // signed out (or switched account) while the app was open
    me = user; isAdmin = false;
    if (!user) { showSignIn(); return; }
    show('<h1>Ball tracker</h1><p>Checking your access</p>');
    check();
  });

  // ---------------------------------------------------------------- access check
  function check() {
    // Only the owner may list requests, so being able to is what marks the owner.
    db.collection('trackerRequests').limit(1).get().then(function () { isAdmin = true; }, function () { isAdmin = false; })
      .then(function () {
        if (isAdmin) return true;
        return db.collection('trackerUsers').doc(me.email).get().then(function (d) { return d.exists; });
      })
      .then(function (allowed) { if (allowed) loadApp(); else watchRequest(); })
      .catch(function () {
        show('<h1>Ball tracker</h1><p>Access could not be checked. If you are the owner, the Firestore rules for the tracker have not been added yet.</p>' + whoLine());
        wireOut();
      });
  }

  function watchRequest() {
    var mine = db.collection('trackerUsers').doc(me.email), req = db.collection('trackerRequests').doc(me.email);
    unsubs.push(mine.onSnapshot(function (d) { if (d.exists) { stop(); loadApp(); } }, function () {}));
    unsubs.push(req.onSnapshot(function (d) { if (d.exists) showWaiting(req); else showRequestForm(req); }, function () { showRequestForm(req); }));
  }
  function showRequestForm(req) {
    show('<h1>Ask for access</h1><p>You are signed in, but the owner has not approved this account yet. Send a request and they will see it.</p>'
      + '<label for="g-name">Your name</label><input type="text" id="g-name" maxlength="40" value="' + esc(me.displayName || '') + '">'
      + '<button class="gbtn primary block" id="g-ask">Send request</button><p class="err" id="g-err"></p>' + whoLine());
    wireOut();
    document.getElementById('g-ask').onclick = function () {
      var name = document.getElementById('g-name').value.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) { document.getElementById('g-err').textContent = 'Add your name so the owner knows who is asking.'; return; }
      this.disabled = true;
      req.set({ name: name, photo: me.photoURL || '', requestedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(function () { document.getElementById('g-err').textContent = 'The request could not be sent. Try again.'; document.getElementById('g-ask').disabled = false; });
    };
  }
  function showWaiting(req) {
    show('<h1>Request sent</h1><p>The owner has been asked to approve this account. This page opens the app by itself once they do.</p>'
      + '<button class="gbtn" id="g-cancel">Withdraw request</button>' + whoLine());
    wireOut();
    document.getElementById('g-cancel').onclick = function () { req.delete().catch(function () {}); };
  }

  // ---------------------------------------------------------------- load the app
  function loadApp() {
    show('<h1>Ball tracker</h1><p>Opening</p>');
    db.collection('trackerApp').doc('current').get().then(function (d) {
      if (!d.exists) {
        if (isAdmin) { showAdmin('No version of the app has been published yet. Upload the bundle file below.'); return; }
        show('<h1>Not published yet</h1><p>You have access, but the owner has not published the app yet.</p>' + whoLine()); wireOut();
        return;
      }
      var b = d.data();
      var style = document.createElement('style'); style.textContent = b.css; document.head.appendChild(style);
      document.getElementById('app-root').innerHTML = b.html;
      // Modules are turned into blob URLs in dependency order, each import pointed at the one before it.
      var urls = {};
      b.order.forEach(function (name) {
        var src = b.files[name].replace(/(from\s+)(['"])\.\/([\w.-]+\.js)\2/g, function (m, pre, q, dep) { return pre + q + urls[dep] + q; });
        urls[name] = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      });
      window.__gate = {
        email: me.email, isAdmin: isAdmin, version: b.version,
        signOut: function () { auth.signOut(); },
        manage: function () { if (isAdmin) showAdmin(''); },
      };
      appLoaded = true;
      return import(urls['app.js']).then(function () { gate.hidden = true; });
    }).catch(function () {
      appLoaded = false;
      show('<h1>Could not open the app</h1><p>Check your connection and reload the page.</p>' + whoLine()); wireOut();
    });
  }

  // ---------------------------------------------------------------- owner: manage access
  function showAdmin(note) {
    stop();
    show('<div class="head"><h1>Manage access</h1><button class="gbtn" id="g-close">' + (appLoaded ? 'Back to the app' : 'Open the app') + '</button></div>'
      + (note ? '<p>' + esc(note) + '</p>' : '')
      + '<h2>Waiting for approval</h2><div class="rows" id="g-reqs"><div class="none">Loading</div></div>'
      + '<h2>Allowed</h2><div class="rows" id="g-users"><div class="none">Loading</div></div>'
      + '<h2>Publish the app</h2><p>Choose the bundle file (tracker.bundle.json) to replace the version approved people get. <span id="g-ver"></span></p>'
      + '<input type="file" id="g-file" accept="application/json,.json" hidden><button class="gbtn" id="g-pub">Choose bundle file</button><p id="g-pubmsg"></p>'
      + whoLine(), true);
    wireOut();
    document.getElementById('g-close').onclick = function () { stop(); if (appLoaded) gate.hidden = true; else loadApp(); };
    db.collection('trackerApp').doc('current').get().then(function (d) {
      document.getElementById('g-ver').textContent = d.exists ? 'Published now: ' + d.data().version + '.' : 'Nothing is published yet.';
    }, function () {});

    unsubs.push(db.collection('trackerRequests').onSnapshot(function (snap) {
      var el = document.getElementById('g-reqs'), h = '';
      snap.forEach(function (d) {
        var x = d.data();
        h += '<div class="rowi"><div class="grow"><div class="nm">' + esc(x.name) + '</div><div class="em">' + esc(d.id) + '</div></div>'
          + '<button class="gbtn primary" data-ok="' + esc(d.id) + '">Approve</button><button class="gbtn" data-no="' + esc(d.id) + '">Decline</button></div>';
      });
      el.innerHTML = h || '<div class="none">Nobody is waiting.</div>';
      el.onclick = function (e) {
        var ok = e.target.getAttribute('data-ok'), no = e.target.getAttribute('data-no');
        if (ok) {
          var doc = null; snap.forEach(function (d) { if (d.id === ok) doc = d.data(); });
          var batch = db.batch();
          batch.set(db.collection('trackerUsers').doc(ok), { name: (doc && doc.name) || '', photo: (doc && doc.photo) || '', approvedBy: me.email, approvedAt: firebase.firestore.FieldValue.serverTimestamp() });
          batch.delete(db.collection('trackerRequests').doc(ok));
          batch.commit().catch(function () {});
        } else if (no) db.collection('trackerRequests').doc(no).delete().catch(function () {});
      };
    }, function () { document.getElementById('g-reqs').innerHTML = '<div class="none">Could not load requests.</div>'; }));

    unsubs.push(db.collection('trackerUsers').onSnapshot(function (snap) {
      var el = document.getElementById('g-users'), h = '';
      snap.forEach(function (d) {
        h += '<div class="rowi"><div class="grow"><div class="nm">' + esc(d.data().name || d.id) + '</div><div class="em">' + esc(d.id) + '</div></div>'
          + '<button class="gbtn danger" data-rm="' + esc(d.id) + '">Remove</button></div>';
      });
      el.innerHTML = h || '<div class="none">Nobody yet. As the owner you always have access.</div>';
      el.onclick = function (e) {
        var rm = e.target.getAttribute('data-rm');
        if (rm && confirm('Remove access for ' + rm + '?')) db.collection('trackerUsers').doc(rm).delete().catch(function () {});
      };
    }, function () { document.getElementById('g-users').innerHTML = '<div class="none">Could not load the list.</div>'; }));

    var file = document.getElementById('g-file'), msg = document.getElementById('g-pubmsg');
    document.getElementById('g-pub').onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files[0];
      if (!f) return;
      f.text().then(function (t) {
        var b = JSON.parse(t);
        if (!b.version || !b.css || !b.html || !b.files || !b.order || !b.files['app.js']) throw new Error('bad');
        msg.className = ''; msg.textContent = 'Publishing ' + b.version;
        return db.collection('trackerApp').doc('current').set({
          version: b.version, css: b.css, html: b.html, files: b.files, order: b.order,
          publishedBy: me.email, publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).then(function () {
          msg.textContent = 'Published ' + b.version + '. Approved people get it the next time they open the page.';
          document.getElementById('g-ver').textContent = 'Published now: ' + b.version + '.';
        });
      }).catch(function () { msg.className = 'err'; msg.textContent = 'That file could not be published. Choose tracker.bundle.json from tracker-src/dist.'; });
      file.value = '';
    };
  }
})();
