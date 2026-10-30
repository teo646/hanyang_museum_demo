/*
 * snap3d annotations: numbered pins on the model surface that open a description.
 * Needs viewer.js (Snap3dViewer, Snap3dViewer.readGlb, Snap3dViewer.mat4) to be loaded first.
 *
 *   Snap3dAnnotations.attach(viewer, { bundle, labels, panel })
 *
 * Add ?edit=1 to the page URL to pick label positions: click the model and the
 * 3D point is shown on screen, logged to the console and copied to the clipboard.
 */
(function () {
  var M = Snap3dViewer.mat4;
  var meshes = {};

  function loadMesh(bundle) {
    if (!meshes[bundle]) {
      meshes[bundle] = fetch(bundle + '/mesh.glb')
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { return Snap3dViewer.readGlb(buf); });
    }
    return meshes[bundle];
  }

  // Moller-Trumbore against every triangle; returns the nearest hit distance or Infinity.
  function raycast(mesh, o, d) {
    var P = mesh.positions, I = mesh.indices, best = Infinity;
    for (var i = 0; i < I.length; i += 3) {
      var a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      var e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      var e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      var px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      var det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      var inv = 1 / det;
      var tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
      var u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      var v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-6 && t < best) best = t;
    }
    return best;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function injectStyle() {
    if (document.getElementById('snap3d-ann-style')) return;
    var s = el('style');
    s.id = 'snap3d-ann-style';
    s.textContent = [
      '.s3a-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
      '.s3a-pin{position:absolute;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;',
      'border:2px solid #fff;background:#c99867;color:#fff;font:700 13px/22px sans-serif;text-align:center;padding:0;',
      'box-shadow:0 1px 5px rgba(0,0,0,.5);cursor:pointer;pointer-events:auto;transition:opacity .2s,background .2s,box-shadow .2s}',
      '.s3a-pin.hidden{opacity:.18;pointer-events:none}',
      '.s3a-pin.active{background:#7a4f24;box-shadow:0 0 0 4px rgba(201,152,103,.5),0 1px 5px rgba(0,0,0,.5)}',
      '.s3a-tag{position:absolute;left:30px;top:50%;transform:translateY(-50%);white-space:nowrap;padding:2px 8px;',
      'border-radius:4px;background:rgba(0,0,0,.72);color:#fff;font:12px/1.5 sans-serif;pointer-events:none;',
      'opacity:0;transition:opacity .15s}',
      '.s3a-pin:hover .s3a-tag,.s3a-pin.active .s3a-tag{opacity:1}',
      '.s3a-panel{margin:1rem 0;padding:1.2rem 1.4rem;border-radius:.6rem;background:#f6f1ea;font-size:1.4rem;line-height:2.4rem}',
      '.s3a-chips{display:flex;flex-wrap:wrap;gap:.6rem;margin-bottom:.8rem}',
      '.s3a-chip{padding:.3rem 1rem;border:1px solid #c99867;border-radius:2rem;background:#fff;color:#7a4f24;',
      'font-size:1.3rem;line-height:2rem;cursor:pointer}',
      '.s3a-chip.active{background:#c99867;color:#fff}',
      '.s3a-title{font-weight:700;font-size:1.6rem;margin-bottom:.4rem}',
      '.s3a-hint{color:#777}',
      '.s3a-reset{margin-top:.8rem;padding:.3rem 1rem;border:0;border-radius:.4rem;background:#c99867;color:#fff;',
      'font-size:1.3rem;cursor:pointer}',
      '.s3a-edit{position:absolute;left:8px;top:8px;max-width:90%;padding:6px 10px;border-radius:6px;',
      'background:rgba(0,0,0,.78);color:#fff;font:12px/1.5 monospace;pointer-events:none;z-index:5}'
    ].join('');
    document.head.appendChild(s);
  }

  function attach(viewer, opts) {
    injectStyle();
    var canvas = viewer.canvas;
    var host = viewer._ensureOverlayHost();
    var layer = el('div', 's3a-layer');
    host.appendChild(layer);

    var panel = el('div', 's3a-panel');
    var chips = el('div', 's3a-chips');
    var body = el('div');
    panel.appendChild(chips);
    panel.appendChild(body);
    host.parentNode.insertBefore(panel, host.nextSibling);

    var labels = opts.labels, pins = [], chipEls = [], active = -1, mesh = null, anim = 0;

    function showHint() {
      body.innerHTML = '';
      body.appendChild(el('div', 's3a-hint', '표면의 번호를 눌러 부위별 설명을 확인해 보세요.'));
    }

    function select(i) {
      active = i;
      pins.forEach(function (p, k) { p.classList.toggle('active', k === i); });
      chipEls.forEach(function (c, k) { c.classList.toggle('active', k === i); });
      body.innerHTML = '';
      var l = labels[i];
      body.appendChild(el('div', 's3a-title', (i + 1) + '. ' + l.title));
      body.appendChild(el('div', 's3a-desc', l.desc));
      var reset = el('button', 's3a-reset', '전체 보기');
      reset.type = 'button';
      reset.onclick = function () {
        active = -1;
        pins.forEach(function (p) { p.classList.remove('active'); });
        chipEls.forEach(function (c) { c.classList.remove('active'); });
        showHint();
        flyTo(null);
      };
      body.appendChild(reset);
      flyTo(l);
    }

    // Smoothly move the camera so the label sits in the middle of the view.
    function flyTo(l) {
      var cam = viewer.camera;
      viewer._autoRotating = false;
      var from = { eye: cam.position.slice(), target: cam.origin.slice() };
      var to;
      if (l) {
        var c = mesh.center, p = l.position;
        var dir = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        var len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        var r = viewer.controls.home.radius * 0.55;
        to = {
          target: p.slice(),
          eye: [p[0] + dir[0] / len * r, p[1] + dir[1] / len * r, p[2] + dir[2] / len * r]
        };
      } else {
        var h = viewer.controls.home;
        var save = { azimuth: cam.azimuth, elevation: cam.elevation, radius: cam.radius, origin: cam.origin.slice() };
        cam.azimuth = h.azimuth; cam.elevation = h.elevation; cam.radius = h.radius; cam.origin = h.target.slice();
        to = { eye: cam.position.slice(), target: h.target.slice() };
        cam.azimuth = save.azimuth; cam.elevation = save.elevation; cam.radius = save.radius; cam.origin = save.origin;
      }
      var t0 = performance.now();
      cancelAnimationFrame(anim);
      (function step(now) {
        var k = Math.min(1, (now - t0) / 650);
        k = k * k * (3 - 2 * k);
        var eye = from.eye.map(function (v, n) { return v + (to.eye[n] - v) * k; });
        var tgt = from.target.map(function (v, n) { return v + (to.target[n] - v) * k; });
        cam.setPose(eye, tgt);
        viewer.requestRender();
        if (k < 1) anim = requestAnimationFrame(step);
      })(t0);
    }

    labels.forEach(function (l, i) {
      var pin = el('button', 's3a-pin', String(i + 1));
      pin.type = 'button';
      pin.setAttribute('aria-label', l.title);
      pin.appendChild(el('span', 's3a-tag', l.title));
      pin.addEventListener('click', function () { select(i); });
      layer.appendChild(pin);
      pins.push(pin);
      var chip = el('button', 's3a-chip', (i + 1) + '. ' + l.title);
      chip.type = 'button';
      chip.addEventListener('click', function () { select(i); });
      chips.appendChild(chip);
      chipEls.push(chip);
    });
    showHint();

    // Projection shared by pins and picking.
    function matrices() {
      var cam = viewer.camera;
      var fov = viewer.options.fov != null ? viewer.options.fov : viewer.config.initial_camera.fov_deg;
      var aspect = canvas.width / canvas.height;
      var view = cam.viewMatrix();
      var proj = M.perspective(fov, aspect, cam.radius * 0.02, cam.radius * 20);
      return { view: view, vp: M.multiply(proj, view), fov: fov, aspect: aspect, eye: cam.position };
    }

    var lastKey = '';
    function update() {
      if (!canvas.isConnected) return;
      requestAnimationFrame(update);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h || !viewer.camera || !mesh) return;
      var m = matrices();
      var key = Array.from(m.vp).join(',') + '|' + w + 'x' + h;
      if (key === lastKey) return;
      lastKey = key;
      labels.forEach(function (l, i) {
        var p = l.position, v = m.vp;
        var cx = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
        var cy = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
        var cw = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
        var pin = pins[i];
        if (cw <= 0) { pin.style.display = 'none'; return; }
        pin.style.display = '';
        pin.style.transform = 'translate(' + ((cx / cw * 0.5 + 0.5) * w) + 'px,' + ((1 - (cy / cw * 0.5 + 0.5)) * h) + 'px)';
        // hidden when the model is in front of the label
        var d = [p[0] - m.eye[0], p[1] - m.eye[1], p[2] - m.eye[2]];
        var dist = Math.hypot(d[0], d[1], d[2]);
        d = [d[0] / dist, d[1] / dist, d[2] / dist];
        var hit = raycast(mesh, m.eye, d);
        pin.classList.toggle('hidden', hit < dist - viewer.camera.radius * 0.02);
      });
    }

    function pick(ev) {
      var rect = canvas.getBoundingClientRect();
      var nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      var ny = 1 - ((ev.clientY - rect.top) / rect.height) * 2;
      var m = matrices(), v = m.view, th = Math.tan(m.fov * Math.PI / 360);
      var right = [v[0], v[4], v[8]], up = [v[1], v[5], v[9]], fwd = [-v[2], -v[6], -v[10]];
      var d = [0, 1, 2].map(function (k) { return fwd[k] + right[k] * nx * th * m.aspect + up[k] * ny * th; });
      var n = Math.hypot(d[0], d[1], d[2]);
      d = d.map(function (c) { return c / n; });
      var t = raycast(mesh, m.eye, d);
      return isFinite(t) ? [0, 1, 2].map(function (k) { return +(m.eye[k] + d[k] * t).toFixed(4); }) : null;
    }

    if (/[?&]edit=1/.test(location.search)) {
      var note = el('div', 's3a-edit', '편집 모드: 모델을 클릭하면 좌표가 표시됩니다.');
      host.appendChild(note);
      var down = null;
      canvas.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
      canvas.addEventListener('pointerup', function (e) {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
        var p = pick(e);
        if (!p) return;
        var txt = '"position": [' + p.join(', ') + ']';
        note.textContent = txt;
        console.log(txt);
        try { navigator.clipboard.writeText(txt); } catch (err) { /* clipboard unavailable */ }
      });
    }

    loadMesh(opts.bundle).then(function (g) {
      var P = g.positions, c = [0, 0, 0], n = P.length / 3;
      for (var i = 0; i < P.length; i += 3) { c[0] += P[i]; c[1] += P[i + 1]; c[2] += P[i + 2]; }
      mesh = { positions: P, indices: g.indices, center: [c[0] / n, c[1] / n, c[2] / n] };
      update();
    });
    return { pick: pick };
  }

  window.Snap3dAnnotations = { attach: attach };
})();
