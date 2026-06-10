/* =========================================================================
   Flouvia · Cotizaciones — núcleo compartido (un solo modal para toda la tienda)
   Lo cargan tanto el app block (página de producto) como el app embed
   (botón flotante / tarjetas / carrito). Se ejecuta una sola vez.

   API pública (window.FlouviaQuote):
     .openFromCart()        → abre con los productos del carrito
     .openProduct(handle)   → abre con UN producto (lo trae de /products/{handle}.js)
     .initCards(opts)       → inyecta un botón en cada tarjeta de producto
     .initFloating(opts)    → crea el botón flotante de esquina
     .initCartButton(opts)  → inyecta el botón en la página de carrito
   ========================================================================= */
(function () {
  if (window.__FlouviaLoaded) return;
  window.__FlouviaLoaded = true;

  var ENDPOINT = '/apps/flouvia-cotizaciones/create';
  var CONFIG_URL = '/apps/flouvia-cotizaciones/config';

  var DEFAULTS = {
    title: 'Solicitar cotización',
    success: 'El vendedor revisará tu solicitud y te contactará con la cotización y el link de pago.',
    accent: '#1a73e8',
    radius: 20,
    overlay: 55
  };
  function cfg(k) {
    var c = window.FLOUVIA_CONFIG || {};
    return (c[k] != null && c[k] !== '') ? c[k] : DEFAULTS[k];
  }

  // ---------------------------------------------------------------- estado
  var built = false;
  var els = {};
  var state = {
    step: 1, items: [], currency: 'MXN',
    pro: false, paid: false, mostrarPrecio: false,
    loaded: false, configLoaded: false,
    fallbackPreset: null   // producto de la página actual (página de producto)
  };

  // ------------------------------------------------------------- utilidades
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(cents) {
    var val = (Number(cents) || 0) / 100;
    try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: state.currency }).format(val); }
    catch (e) { return '$' + val.toFixed(2) + ' ' + state.currency; }
  }
  function imgUrl(x) {
    if (!x) return null;
    if (typeof x === 'string') return x;
    return x.src || null;   // variant.featured_image suele venir como objeto {src}
  }
  function handleFromUrl(href) {
    if (!href) return null;
    var m = String(href).match(/\/products\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // ------------------------------------------------------- HTML del modal
  var MODAL_HTML =
    '<div class="flouvia-overlay" data-flouvia-overlay aria-hidden="true">' +
      '<div class="flouvia-modal" role="dialog" aria-modal="true">' +
        '<div class="flouvia-head">' +
          '<div class="flouvia-head-t"><span class="flouvia-head-ic">🧾</span><span data-fq-modal-title></span></div>' +
          '<button type="button" class="flouvia-x" data-flouvia-close aria-label="Cerrar">&times;</button>' +
        '</div>' +
        '<div class="flouvia-stepper">' +
          '<div class="flouvia-step-item active" data-step-dot="1"><span class="flouvia-step-n">1</span><span class="flouvia-step-l">Productos</span></div>' +
          '<div class="flouvia-step-bar"><span data-flouvia-bar></span></div>' +
          '<div class="flouvia-step-item" data-step-dot="2"><span class="flouvia-step-n">2</span><span class="flouvia-step-l">Contacto</span></div>' +
          '<div class="flouvia-step-bar"><span data-flouvia-bar></span></div>' +
          '<div class="flouvia-step-item" data-step-dot="3"><span class="flouvia-step-n">3</span><span class="flouvia-step-l">Revisar</span></div>' +
        '</div>' +
        '<div class="flouvia-body">' +
          '<section data-flouvia-panel="1">' +
            '<p class="flouvia-lead" data-fq-lead="1">Estos son los productos que vas a cotizar. Ajusta las cantidades. <span class="flouvia-muted">No modificamos tu carrito.</span></p>' +
            '<div data-flouvia-products class="flouvia-products"></div>' +
            '<div data-flouvia-empty class="flouvia-empty" style="display:none;">' +
              '<div class="flouvia-empty-ic">🛒</div>' +
              '<div class="flouvia-empty-t">No hay productos para cotizar</div>' +
              '<div class="flouvia-empty-d">Agrega productos y vuelve a abrir esta ventana para cotizarlos.</div>' +
            '</div>' +
          '</section>' +
          '<section data-flouvia-panel="2" style="display:none;">' +
            '<p class="flouvia-lead" data-fq-lead="2">¿A quién contactamos con la cotización?</p>' +
            '<div class="flouvia-grid">' +
              '<div class="flouvia-field"><label class="flouvia-label">Nombre <span class="flouvia-req">*</span></label><input type="text" class="flouvia-input" data-flouvia-name placeholder="Tu nombre" /><span class="flouvia-err" data-err-name></span></div>' +
              '<div class="flouvia-field"><label class="flouvia-label">Correo electrónico <span class="flouvia-req">*</span></label><input type="email" class="flouvia-input" data-flouvia-email placeholder="tucorreo@empresa.com" /><span class="flouvia-err" data-err-email></span></div>' +
              '<div class="flouvia-field flouvia-pro"><label class="flouvia-label">Teléfono</label><input type="tel" class="flouvia-input" data-flouvia-phone placeholder="55 1234 5678" /></div>' +
              '<div class="flouvia-field flouvia-pro"><label class="flouvia-label">Empresa</label><input type="text" class="flouvia-input" data-flouvia-company placeholder="Mi Empresa SA de CV" /></div>' +
              '<div class="flouvia-field flouvia-pro"><label class="flouvia-label">RFC <span class="flouvia-muted">(para tu factura)</span></label><input type="text" class="flouvia-input" data-flouvia-rfc maxlength="13" placeholder="XAXX010101000" /><span class="flouvia-err" data-err-rfc></span></div>' +
              '<div class="flouvia-field flouvia-pro"><label class="flouvia-label">Términos de pago que solicitas</label><select class="flouvia-input" data-flouvia-terminos></select></div>' +
              '<div class="flouvia-field flouvia-full"><label class="flouvia-label">Notas o condiciones especiales</label><textarea class="flouvia-input" data-flouvia-notes rows="3" placeholder="Ej. Necesito 200 unidades, entrega antes del día 15…"></textarea></div>' +
            '</div>' +
          '</section>' +
          '<section data-flouvia-panel="3" style="display:none;">' +
            '<p class="flouvia-lead" data-fq-lead="3">Revisa que todo esté correcto antes de enviar.</p>' +
            '<div class="flouvia-review-card"><div class="flouvia-review-h">Productos</div><div data-flouvia-review-products class="flouvia-review-products"></div></div>' +
            '<div class="flouvia-review-card"><div class="flouvia-review-h">Tus datos</div><div data-flouvia-review-contact class="flouvia-review-contact"></div></div>' +
          '</section>' +
        '</div>' +
        '<div class="flouvia-foot">' +
          '<p data-flouvia-msg class="flouvia-msg"></p>' +
          '<div class="flouvia-foot-btns">' +
            '<button type="button" class="flouvia-btn ghost" data-flouvia-back style="display:none;">← Atrás</button>' +
            '<button type="button" class="flouvia-btn primary" data-flouvia-next>Siguiente →</button>' +
            '<button type="button" class="flouvia-btn primary" data-flouvia-submit style="display:none;">Enviar solicitud</button>' +
          '</div>' +
          '<div class="flouvia-brand" data-flouvia-brand style="display:none;">Cotizaciones por <strong>Flouvia</strong></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  // ----------------------------------------------------- construir el modal
  function buildModal() {
    if (built) return;
    built = true;

    var wrap = document.createElement('div');
    wrap.innerHTML = MODAL_HTML;
    var overlay = wrap.firstElementChild;
    document.body.appendChild(overlay);

    els.overlay = overlay;
    els.modal = overlay.querySelector('.flouvia-modal');
    els.closeBtn = overlay.querySelector('[data-flouvia-close]');
    els.backBtn = overlay.querySelector('[data-flouvia-back]');
    els.nextBtn = overlay.querySelector('[data-flouvia-next]');
    els.submitBtn = overlay.querySelector('[data-flouvia-submit]');
    els.msg = overlay.querySelector('[data-flouvia-msg]');
    els.panels = overlay.querySelectorAll('[data-flouvia-panel]');
    els.dots = overlay.querySelectorAll('[data-step-dot]');
    els.bars = overlay.querySelectorAll('[data-flouvia-bar]');
    els.bodyEl = overlay.querySelector('.flouvia-body');
    els.footEl = overlay.querySelector('.flouvia-foot');
    els.productsBox = overlay.querySelector('[data-flouvia-products]');
    els.emptyBox = overlay.querySelector('[data-flouvia-empty]');
    els.terminosSel = overlay.querySelector('[data-flouvia-terminos]');
    els.titleEl = overlay.querySelector('[data-fq-modal-title]');

    // Aplicar configuración del editor de temas
    els.titleEl.textContent = cfg('title');
    els.modal.setAttribute('aria-label', cfg('title'));
    els.modal.style.setProperty('--fq-accent', cfg('accent'));
    els.modal.style.setProperty('--fq-radius', (parseInt(cfg('radius'), 10) || 20) + 'px');
    var ov = Number(cfg('overlay')); if (isNaN(ov)) ov = 55;
    els.overlay.style.background = 'rgba(15,23,42,' + (Math.max(0, Math.min(90, ov)) / 100) + ')';

    wireEvents();
  }

  function field(sel) { return els.overlay.querySelector(sel); }
  function setMsg(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'flouvia-msg' + (kind ? ' ' + kind : '');
  }

  // -------------------------------------------------- carga de datos
  function itemFromCartLine(i) {
    return {
      variantId: i.variant_id, quantity: i.quantity,
      title: i.product_title || i.title,
      variantTitle: (i.variant_title && i.variant_title !== 'Default Title') ? i.variant_title : '',
      image: i.image, unitPrice: i.final_price
    };
  }
  function loadCart() {
    return fetch('/cart.js').then(function (r) { return r.json(); }).then(function (cart) {
      state.currency = cart.currency || 'MXN';
      state.items = (cart.items || []).map(itemFromCartLine);
    }).catch(function () { state.items = []; }).then(function () {
      // Carrito vacío en página de producto → precargar ese producto (tienda solo-cotización)
      if (!state.items.length && state.fallbackPreset) {
        var it = itemFromBlockPreset(state.fallbackPreset);
        if (it) state.items = [it];
      }
    });
  }
  // Preset de la página de producto (JSON que emite el app block, respeta ?variant=)
  function itemFromBlockPreset(p) {
    if (!p || !p.variants || !p.variants.length) return null;
    var vid = null;
    try { vid = parseInt(new URL(window.location.href).searchParams.get('variant'), 10); } catch (e) {}
    var v = p.variants.filter(function (x) { return x.id === vid; })[0]
         || p.variants.filter(function (x) { return x.id === p.selected; })[0]
         || p.variants[0];
    if (!v) return null;
    return {
      variantId: v.id, quantity: 1, title: p.title,
      variantTitle: (v.title && v.title !== 'Default Title') ? v.title : '',
      image: imgUrl(v.image) || imgUrl(p.featured_image), unitPrice: v.price
    };
  }
  // UN producto, traído de /products/{handle}.js (para botones de tarjeta)
  function loadProductByHandle(handle) {
    return fetch('/products/' + handle + '.js').then(function (r) { return r.json(); }).then(function (p) {
      var v = (p.variants || []).filter(function (x) { return x.available; })[0] || (p.variants || [])[0];
      if (!v) { state.items = []; return; }
      state.items = [{
        variantId: v.id, quantity: 1, title: p.title,
        variantTitle: (v.title && v.title !== 'Default Title') ? v.title : '',
        image: imgUrl(v.featured_image) || imgUrl(p.featured_image), unitPrice: v.price
      }];
    }).catch(function () { state.items = []; });
  }

  function loadConfig() {
    if (state.configLoaded) return Promise.resolve();
    return fetch(CONFIG_URL).then(function (r) { return r.json(); }).then(function (d) {
      state.configLoaded = true;
      state.pro = !!(d && d.pro);
      state.paid = !!(d && d.paid);
      state.mostrarPrecio = !!(d && d.config && d.config.boton && d.config.boton.mostrarPrecio);
      if (state.pro) els.modal.classList.add('is-pro');
      applyFormulario(d && d.config && d.config.formulario);
      if (!state.paid) {
        var brand = els.overlay.querySelector('[data-flouvia-brand]');
        if (brand) brand.style.display = 'block';
      }
      var cr = (d && d.config && d.config.credito) || {};
      var terms = cr.terminos || [];
      var def = cr.porDefecto || '';
      if (els.terminosSel) {
        els.terminosSel.innerHTML = '';
        var optSin = document.createElement('option');
        optSin.value = ''; optSin.textContent = 'Sin preferencia';
        els.terminosSel.appendChild(optSin);
        terms.forEach(function (t) {
          var o = document.createElement('option');
          o.value = t; o.textContent = t;
          if (t === def) o.selected = true;
          els.terminosSel.appendChild(o);
        });
      }
    }).catch(function () { state.configLoaded = true; state.pro = false; });
  }

  // Override Pro del formulario (encima de la config del editor de temas)
  function setLead(n, text) {
    if (!text) return;
    var el = els.overlay.querySelector('[data-fq-lead="' + n + '"]');
    if (el) el.textContent = text;
  }
  function applyFormulario(f) {
    if (!f) return;
    var t = f.textos || {};
    var a = f.apariencia || {};
    if (a.colorAcento) els.modal.style.setProperty('--fq-accent', a.colorAcento);
    if (t.tituloModal) {
      els.titleEl.textContent = t.tituloModal;
      els.modal.setAttribute('aria-label', t.tituloModal);
      CFGtitle = t.tituloModal;
    }
    if (t.mensajeExito) CFGsuccess = t.mensajeExito;
    setLead('1', t.leadPaso1);
    setLead('2', t.leadPaso2);
    setLead('3', t.leadPaso3);
  }
  // Título / mensaje de éxito efectivos (config del tema, sobreescribibles por Pro)
  var CFGtitle, CFGsuccess;

  // ------------------------------------------------------ render productos
  function renderProducts() {
    if (!state.items.length) {
      els.productsBox.style.display = 'none';
      els.emptyBox.style.display = 'block';
      return;
    }
    els.productsBox.style.display = 'flex';
    els.emptyBox.style.display = 'none';
    els.productsBox.innerHTML = '';
    state.items.forEach(function (it, idx) {
      var row = document.createElement('div');
      row.className = 'flouvia-prow';
      var img = it.image
        ? '<img class="flouvia-pimg" src="' + it.image + '" alt="" />'
        : '<div class="flouvia-pimg"></div>';
      var precio = state.mostrarPrecio
        ? '<div class="flouvia-pprice">' + money(it.unitPrice) + ' c/u</div>' : '';
      row.innerHTML =
        img +
        '<div class="flouvia-pinfo">' +
          '<div class="flouvia-pname">' + escapeHtml(it.title) + '</div>' +
          (it.variantTitle ? '<div class="flouvia-pvar">' + escapeHtml(it.variantTitle) + '</div>' : '') +
          precio +
        '</div>' +
        '<div class="flouvia-qty">' +
          '<button type="button" data-dec="' + idx + '">−</button>' +
          '<input type="number" min="1" value="' + it.quantity + '" data-qty="' + idx + '" />' +
          '<button type="button" data-inc="' + idx + '">+</button>' +
        '</div>' +
        '<button type="button" class="flouvia-remove" data-rm="' + idx + '" aria-label="Quitar">&times;</button>';
      els.productsBox.appendChild(row);
    });
  }

  // ---------------------------------------------------------- validación
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function validRfc(v) { return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v); }
  function mark(input, errAttr, errText) {
    input.classList.toggle('bad', !!errText);
    var e = els.overlay.querySelector('[' + errAttr + ']');
    if (e) e.textContent = errText;
  }
  function validateStep2() {
    var ok = true;
    var name = field('[data-flouvia-name]');
    var email = field('[data-flouvia-email]');
    var rfc = field('[data-flouvia-rfc]');
    if (!name.value.trim()) { mark(name, 'data-err-name', 'Escribe tu nombre.'); ok = false; }
    else { mark(name, 'data-err-name', ''); }
    if (!validEmail(email.value.trim())) { mark(email, 'data-err-email', 'Correo no válido.'); ok = false; }
    else { mark(email, 'data-err-email', ''); }
    if (state.pro && rfc.value.trim() && !validRfc(rfc.value.trim().toUpperCase())) {
      mark(rfc, 'data-err-rfc', 'RFC no válido (12 o 13 caracteres).'); ok = false;
    } else { mark(rfc, 'data-err-rfc', ''); }
    return ok;
  }

  // ------------------------------------------------------- navegación pasos
  function showStep(n) {
    state.step = n;
    els.panels.forEach(function (p) { p.style.display = (p.dataset.flouviaPanel == n) ? 'block' : 'none'; });
    els.dots.forEach(function (d) {
      var dn = +d.dataset.stepDot;
      d.classList.toggle('active', dn === n);
      d.classList.toggle('done', dn < n);
    });
    els.bars.forEach(function (b, i) { b.style.width = (i < n - 1) ? '100%' : '0'; });
    els.bodyEl.scrollTop = 0;
    setMsg('');
    if (n === 3) renderReview();
    updateNav();
  }
  function updateNav() {
    els.backBtn.style.display = state.step > 1 ? 'inline-block' : 'none';
    els.nextBtn.style.display = state.step < 3 ? 'inline-block' : 'none';
    els.submitBtn.style.display = state.step === 3 ? 'inline-block' : 'none';
    if (state.step === 1) els.nextBtn.disabled = state.items.length === 0;
    else els.nextBtn.disabled = false;
  }

  function renderReview() {
    var rp = els.overlay.querySelector('[data-flouvia-review-products]');
    rp.innerHTML = state.items.map(function (it) {
      return '<div class="flouvia-rrow"><span>' + escapeHtml(it.title) +
        (it.variantTitle ? ' · ' + escapeHtml(it.variantTitle) : '') +
        '</span><span class="q">×' + it.quantity + '</span></div>';
    }).join('');
    var rows = [];
    function add(k, v) { if (v && v.trim()) rows.push('<span class="k">' + k + '</span><span class="v">' + escapeHtml(v) + '</span>'); }
    add('Nombre', field('[data-flouvia-name]').value);
    add('Correo', field('[data-flouvia-email]').value);
    if (state.pro) {
      add('Teléfono', field('[data-flouvia-phone]').value);
      add('Empresa', field('[data-flouvia-company]').value);
      add('RFC', field('[data-flouvia-rfc]').value);
      add('Términos', els.terminosSel ? els.terminosSel.value : '');
    }
    add('Notas', field('[data-flouvia-notes]').value);
    els.overlay.querySelector('[data-flouvia-review-contact]').innerHTML = rows.join('');
  }

  // ------------------------------------------------------------- enviar
  function enviar() {
    els.submitBtn.disabled = true;
    els.backBtn.disabled = true;
    setMsg('Enviando solicitud…');
    var payload = {
      lineItems: state.items.map(function (it) { return { variantId: it.variantId, quantity: it.quantity }; }),
      name: field('[data-flouvia-name]').value.trim(),
      email: field('[data-flouvia-email]').value.trim(),
      notes: field('[data-flouvia-notes]').value.trim()
    };
    if (state.pro) {
      payload.phone = field('[data-flouvia-phone]').value.trim();
      payload.company = field('[data-flouvia-company]').value.trim();
      payload.rfc = field('[data-flouvia-rfc]').value.trim().toUpperCase();
      payload.terminos = els.terminosSel ? els.terminosSel.value : '';
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = null; try { data = JSON.parse(raw); } catch (e) {}
        if (res.ok && data && data.ok) { showSuccess(data.name); }
        else {
          var detalle = (data && data.error) ? data.error : ('Error (' + res.status + '): ' + raw.slice(0, 140));
          setMsg(detalle, 'bad');
          els.submitBtn.disabled = false; els.backBtn.disabled = false;
        }
      });
    }).catch(function (e) {
      setMsg('Error de conexión: ' + (e && e.message ? e.message : e), 'bad');
      els.submitBtn.disabled = false; els.backBtn.disabled = false;
    });
  }
  function showSuccess(quoteName) {
    // Si la solicitud salió del carrito de cotización, vacíalo (ya quedó enviado).
    if (state.source === 'quote') FlouviaStore.clear();
    els.bodyEl.innerHTML =
      '<div class="flouvia-success">' +
        '<div class="flouvia-success-ic">✓</div>' +
        '<div class="flouvia-success-t">¡Solicitud enviada!</div>' +
        '<div class="flouvia-success-d">' + escapeHtml(CFGsuccess || cfg('success')) +
          (quoteName ? '<br><br><strong>Folio: ' + escapeHtml(quoteName) + '</strong>' : '') +
        '</div>' +
      '</div>';
    els.overlay.querySelector('.flouvia-stepper').style.display = 'none';
    els.footEl.innerHTML = '<div class="flouvia-foot-btns"><button type="button" class="flouvia-btn primary" data-flouvia-done>Cerrar</button></div>';
    els.footEl.querySelector('[data-flouvia-done]').addEventListener('click', closeModal);
  }

  // ------------------------------------------------------- abrir / cerrar
  function closeModal() {
    els.overlay.classList.remove('open');
    els.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  // opts.source: 'cart' (default) | 'handle' (opts.handle) | 'quote' (carrito de cotización en localStorage)
  function open(opts) {
    opts = opts || {};
    state.source = opts.source || 'cart';
    buildModal();
    els.overlay.classList.add('open');
    els.overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    state.step = 1;
    setMsg('Cargando…');
    // Reconstruir el pie/stepper por si una solicitud previa lo dejó en "éxito"
    resetIfNeeded();

    var jobs = [loadConfig()];
    if (opts.source === 'handle' && opts.handle) jobs.push(loadProductByHandle(opts.handle));
    else if (opts.source === 'quote') jobs.push(loadQuoteStore());
    else jobs.push(loadCart());

    Promise.all(jobs).then(function () {
      setMsg('');
      renderProducts();
      showStep(1);
    });
  }
  // Si tras un envío exitoso se reabre el modal, reconstruimos cuerpo y pie.
  var pristineFoot = null, pristineBody = null;
  function snapshot() {
    if (pristineFoot == null) pristineFoot = els.footEl.innerHTML;
    if (pristineBody == null) pristineBody = els.bodyEl.innerHTML;
  }
  function resetIfNeeded() {
    if (!els.overlay.querySelector('[data-flouvia-products]')) {
      els.bodyEl.innerHTML = pristineBody;
      els.footEl.innerHTML = pristineFoot;
      els.overlay.querySelector('.flouvia-stepper').style.display = '';
      // re-cachear y re-enganchar
      cacheBody(); wireFoot();
    }
  }
  function cacheBody() {
    els.panels = els.overlay.querySelectorAll('[data-flouvia-panel]');
    els.productsBox = els.overlay.querySelector('[data-flouvia-products]');
    els.emptyBox = els.overlay.querySelector('[data-flouvia-empty]');
    els.terminosSel = els.overlay.querySelector('[data-flouvia-terminos]');
    wireProducts();
  }

  // ------------------------------------------------------------- eventos
  function wireProducts() {
    els.productsBox.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.inc != null) { state.items[+t.dataset.inc].quantity++; renderProducts(); syncQuoteFromState(); }
      else if (t.dataset.dec != null) { var i = +t.dataset.dec; if (state.items[i].quantity > 1) { state.items[i].quantity--; renderProducts(); syncQuoteFromState(); } }
      else if (t.dataset.rm != null) { state.items.splice(+t.dataset.rm, 1); renderProducts(); updateNav(); syncQuoteFromState(); }
    });
    els.productsBox.addEventListener('change', function (e) {
      if (e.target.dataset.qty != null) {
        var i = +e.target.dataset.qty;
        var q = parseInt(e.target.value, 10);
        state.items[i].quantity = (isNaN(q) || q < 1) ? 1 : q;
        renderProducts();
        syncQuoteFromState();
      }
    });
  }
  // Si el modal se abrió desde el carrito de cotización, refleja los cambios de cantidad
  // de vuelta en localStorage para que el drawer quede sincronizado.
  function syncQuoteFromState() {
    if (state.source !== 'quote') return;
    FlouviaStore.replace(state.items);
  }
  function wireFoot() {
    els.footEl = els.overlay.querySelector('.flouvia-foot');
    els.msg = els.overlay.querySelector('[data-flouvia-msg]');
    els.backBtn = els.overlay.querySelector('[data-flouvia-back]');
    els.nextBtn = els.overlay.querySelector('[data-flouvia-next]');
    els.submitBtn = els.overlay.querySelector('[data-flouvia-submit]');
    els.dots = els.overlay.querySelectorAll('[data-step-dot]');
    els.bars = els.overlay.querySelectorAll('[data-flouvia-bar]');
    els.nextBtn.addEventListener('click', function () {
      if (state.step === 1) { if (state.items.length) showStep(2); }
      else if (state.step === 2) { if (validateStep2()) showStep(3); }
    });
    els.backBtn.addEventListener('click', function () { if (state.step > 1) showStep(state.step - 1); });
    els.submitBtn.addEventListener('click', enviar);
  }
  function wireEvents() {
    snapshot();
    cacheBody();
    wireFoot();
    els.closeBtn.addEventListener('click', closeModal);
    els.overlay.addEventListener('click', function (e) { if (e.target === els.overlay) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.overlay.classList.contains('open')) closeModal();
    });
  }

  // ============================ DISPARADORES ============================

  // Disparadores estáticos por delegación: cualquier elemento [data-flouvia-open].
  // valor "handle:xxx" abre ese producto; cualquier otro valor abre desde el carrito.
  document.addEventListener('click', function (e) {
    var trg = e.target.closest && e.target.closest('[data-flouvia-open]');
    if (!trg) return;
    e.preventDefault();
    e.stopPropagation();   // evita navegar si la tarjeta es un enlace que envuelve el botón
    var v = trg.getAttribute('data-flouvia-open') || '';
    if (v.indexOf('handle:') === 0) open({ source: 'handle', handle: v.slice(7) });
    else open({ source: 'cart' });
  });

  // Preset de la página de producto (lo emite el app block como JSON)
  function captureProductPreset() {
    var node = document.querySelector('[data-flouvia-product]');
    if (!node) return;
    try { state.fallbackPreset = JSON.parse(node.textContent); } catch (e) {}
  }

  // ---------- Botón flotante ----------
  function initFloating(opts) {
    opts = opts || {};
    if (document.querySelector('.flouvia-float')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flouvia-float' +
      (opts.shadow === false ? ' no-shadow' : '') +
      (opts.hideMobile ? ' flouvia-hide-mobile' : '');
    btn.setAttribute('data-pos', opts.position || 'bottom-right');
    btn.setAttribute('data-flouvia-open', 'cart');
    btn.style.background = opts.bg || cfg('accent');
    btn.style.color = opts.color || '#ffffff';
    btn.style.borderRadius = (opts.radius != null ? opts.radius : 999) + 'px';
    btn.style.padding = (opts.paddingY != null ? opts.paddingY : 14) + 'px ' + (opts.paddingX != null ? opts.paddingX : 20) + 'px';
    btn.style.fontSize = (opts.fontSize != null ? opts.fontSize : 15) + 'px';
    if (opts.weight) btn.style.fontWeight = opts.weight;
    var ic = opts.icon ? '<span class="flouvia-float-ic">' + opts.icon + '</span>' : '';
    var lbl = '<span>' + escapeHtml(opts.label || 'Solicitar cotización') + '</span>';
    btn.innerHTML = (opts.iconPos === 'right') ? (lbl + ic) : (ic + lbl);
    document.body.appendChild(btn);
  }

  // ---------- Botón en la página de carrito ----------
  function initCartButton(opts) {
    opts = opts || {};
    var path = window.location.pathname;
    if (path.indexOf('/cart') === -1) return;            // solo en /cart
    var host = opts.selector ? document.querySelector(opts.selector) : null;
    if (!host) host = document.querySelector('.cart__footer, .cart-footer, form[action="/cart"], #main-cart-footer');
    if (!host || host.querySelector('.flouvia-cart-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flouvia-cart-btn';
    btn.setAttribute('data-flouvia-open', 'cart');
    btn.style.background = opts.bg || cfg('accent');
    btn.style.color = opts.color || '#ffffff';
    btn.style.borderRadius = (opts.radius != null ? opts.radius : 8) + 'px';
    btn.style.padding = (opts.paddingY != null ? opts.paddingY : 14) + 'px ' + (opts.paddingX != null ? opts.paddingX : 22) + 'px';
    btn.style.fontSize = (opts.fontSize != null ? opts.fontSize : 15) + 'px';
    if (opts.weight) btn.style.fontWeight = opts.weight;
    if (opts.fullWidth) btn.style.width = '100%';
    btn.textContent = opts.label || 'Solicitar cotización del carrito';
    host.appendChild(btn);
  }

  // ---------- Inyección en tarjetas de producto ----------
  var DEFAULT_CARD_SELECTOR = '.card-wrapper, .product-card-wrapper, .grid-product, .product-card, .product-item';
  function makeCardButton(opts, handle) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flouvia-card-btn' + (opts.position === 'overlay' ? ' flouvia-card-btn--overlay' : '');
    btn.setAttribute('data-flouvia-open', 'handle:' + handle);
    btn.style.background = opts.bg || cfg('accent');
    btn.style.color = opts.color || '#ffffff';
    btn.style.borderRadius = (opts.radius != null ? opts.radius : 8) + 'px';
    btn.style.padding = (opts.paddingY != null ? opts.paddingY : 8) + 'px ' + (opts.paddingX != null ? opts.paddingX : 12) + 'px';
    btn.style.fontSize = (opts.fontSize != null ? opts.fontSize : 13) + 'px';
    if (opts.weight) btn.style.fontWeight = opts.weight;
    btn.textContent = opts.label || 'Cotizar';
    return btn;
  }
  function placeCardButton(card, opts, handle) {
    var btn = makeCardButton(opts, handle);
    if (opts.position === 'overlay') {
      var media = card.querySelector('.card__media, .card__inner, .media, .product-card__image, .grid-product__image');
      var host = media || card;
      host.classList.add('flouvia-card-host');
      host.appendChild(btn);
    } else {
      var info = card.querySelector('.card__content, .card-information, .product-card__info, .grid-product__meta');
      (info || card).appendChild(btn);
    }
  }
  function initCards(opts) {
    opts = opts || {};
    var sel = (opts.selector && opts.selector.trim()) || DEFAULT_CARD_SELECTOR;
    function scan() {
      var cards;
      try { cards = document.querySelectorAll(sel); } catch (e) { return; }
      Array.prototype.forEach.call(cards, function (card) {
        if (card.__flouviaCard || card.querySelector('.flouvia-card-btn')) return;
        var link = card.querySelector('a[href*="/products/"]');
        var handle = link && handleFromUrl(link.getAttribute('href') || link.href);
        if (!handle) return;
        card.__flouviaCard = true;
        placeCardButton(card, opts, handle);
      });
    }
    scan();
    // Carruseles y colecciones que cargan tarjetas dinámicamente
    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; scan(); }, 200);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ===================================================================
  //  CARRITO DE COTIZACIÓN  (lista propia en localStorage + drawer)
  //  Es independiente del carrito real de Shopify: el cliente junta
  //  productos aquí, los previsualiza en el drawer y al final los manda
  //  por el mismo modal de 3 pasos (open({source:'quote'})).
  // ===================================================================
  var STORE_KEY = 'flouvia_quote_v1';
  var storeSubs = [];
  function emitStore() { for (var i = 0; i < storeSubs.length; i++) { try { storeSubs[i](); } catch (e) {} } }

  var FlouviaStore = {
    _raw: function () { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } },
    read: function () { var r = this._raw(); return (r && r.items) ? r.items : []; },
    currency: function () { return this._raw().currency || null; },
    _save: function (items, currency) {
      var payload = { items: items, currency: currency || this.currency() || 'MXN' };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (e) {}
      emitStore();
    },
    // Normaliza y reescribe toda la lista (usado al sincronizar desde el modal).
    replace: function (items, currency) {
      this._save((items || []).map(function (it) {
        return {
          variantId: it.variantId, quantity: it.quantity || 1, title: it.title,
          variantTitle: it.variantTitle || '', image: it.image || null, unitPrice: it.unitPrice
        };
      }), currency);
    },
    add: function (item) {
      var items = this.read(), hit = null;
      for (var i = 0; i < items.length; i++) { if (items[i].variantId === item.variantId) { hit = items[i]; break; } }
      if (hit) hit.quantity += (item.quantity || 1);
      else items.push({
        variantId: item.variantId, quantity: item.quantity || 1, title: item.title,
        variantTitle: item.variantTitle || '', image: item.image || null, unitPrice: item.unitPrice
      });
      this._save(items, item.currency);
    },
    setQty: function (variantId, qty) {
      var items = this.read();
      for (var i = 0; i < items.length; i++) { if (items[i].variantId === variantId) items[i].quantity = qty < 1 ? 1 : qty; }
      this._save(items);
    },
    remove: function (variantId) {
      this._save(this.read().filter(function (x) { return x.variantId !== variantId; }));
    },
    clear: function () { this._save([]); },
    count: function () { return this.read().reduce(function (n, x) { return n + (x.quantity || 0); }, 0); }
  };
  // Sincronía entre pestañas del navegador.
  window.addEventListener('storage', function (e) { if (e.key === STORE_KEY) emitStore(); });

  // Carga la lista guardada hacia el estado del modal (copia, no referencia).
  function loadQuoteStore() {
    return Promise.resolve().then(function () {
      state.currency = FlouviaStore.currency() || state.currency || 'MXN';
      state.items = FlouviaStore.read().map(function (it) {
        return {
          variantId: it.variantId, quantity: it.quantity, title: it.title,
          variantTitle: it.variantTitle || '', image: it.image || null, unitPrice: it.unitPrice
        };
      });
    });
  }

  // Moneda activa de la tienda (para guardar junto a los precios).
  function shopCurrency() {
    try { return (window.Shopify && Shopify.currency && Shopify.currency.active) || null; } catch (e) { return null; }
  }

  // -------- Construir un ítem desde el preset de la página de producto --------
  function readSelectedVariantId() {
    var el = document.querySelector('form[action*="/cart/add"] [name="id"], [name="id"]');
    var vid = el ? parseInt(el.value, 10) : NaN;
    if (!vid || isNaN(vid)) { try { vid = parseInt(new URL(location.href).searchParams.get('variant'), 10); } catch (e) {} }
    return (vid && !isNaN(vid)) ? vid : null;
  }
  function buildItemFromPreset(vid) {
    var p = state.fallbackPreset;
    if (!p || !p.variants || !p.variants.length) return null;
    var v = (vid && p.variants.filter(function (x) { return x.id === vid; })[0]) ||
            p.variants.filter(function (x) { return x.id === p.selected; })[0] || p.variants[0];
    if (!v) return null;
    return {
      variantId: v.id, quantity: 1, title: p.title,
      variantTitle: (v.title && v.title !== 'Default Title') ? v.title : '',
      image: imgUrl(v.image) || imgUrl(p.featured_image), unitPrice: v.price, currency: shopCurrency()
    };
  }
  // -------- Agregar por handle (tarjetas, sin variante específica) --------
  function addByHandle(handle) {
    return fetch('/products/' + handle + '.js').then(function (r) { return r.json(); }).then(function (p) {
      var v = (p.variants || []).filter(function (x) { return x.available; })[0] || (p.variants || [])[0];
      if (!v) return false;
      FlouviaStore.add({
        variantId: v.id, quantity: 1, title: p.title,
        variantTitle: (v.title && v.title !== 'Default Title') ? v.title : '',
        image: imgUrl(v.featured_image) || imgUrl(p.featured_image), unitPrice: v.price, currency: shopCurrency()
      });
      return true;
    }).catch(function () { return false; });
  }
  // -------- Agregar el producto de la página actual --------
  function addCurrentPage() {
    var it = buildItemFromPreset(readSelectedVariantId());
    if (it) { FlouviaStore.add(it); return Promise.resolve(true); }
    var handle = handleFromUrl(location.pathname);
    if (handle) return addByHandle(handle);
    return Promise.resolve(false);
  }

  // Feedback visual al agregar: el botón dice "✓ Agregado" un momento.
  function flashAdded(btn) {
    if (!btn || btn.__flouviaFlashing) return;
    btn.__flouviaFlashing = true;
    var orig = btn.innerHTML;
    btn.classList.add('flouvia-added');
    btn.innerHTML = '✓ Agregado';
    setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('flouvia-added'); btn.__flouviaFlashing = false; }, 1400);
  }

  // Disparadores estáticos por delegación: cualquier [data-flouvia-add].
  //   "handle:xxx" → agrega ese producto · cualquier otro valor → producto de la página actual.
  var OPEN_DRAWER_ON_ADD = false;
  document.addEventListener('click', function (e) {
    var trg = e.target.closest && e.target.closest('[data-flouvia-add]');
    if (!trg) return;
    e.preventDefault();
    e.stopPropagation();
    var v = trg.getAttribute('data-flouvia-add') || '';
    var job = (v.indexOf('handle:') === 0) ? addByHandle(v.slice(7)) : addCurrentPage();
    job.then(function (ok) {
      if (!ok) return;
      flashAdded(trg);
      if (OPEN_DRAWER_ON_ADD && drawerEls.overlay) openDrawer();
    });
  });

  // ----------------------------------- DRAWER (vista previa) -----------------------------------
  var drawerEls = {};
  var DRAWER_HTML =
    '<div class="flouvia-drawer-ov" data-fqd-overlay aria-hidden="true">' +
      '<aside class="flouvia-drawer" role="dialog" aria-modal="true">' +
        '<div class="flouvia-drawer-head">' +
          '<span class="flouvia-drawer-ttl"><span class="flouvia-drawer-ic">🧾</span><span data-fqd-title>Mi cotización</span></span>' +
          '<button type="button" class="flouvia-x" data-fqd-close aria-label="Cerrar">&times;</button>' +
        '</div>' +
        '<div class="flouvia-drawer-body" data-fqd-body></div>' +
        '<div class="flouvia-drawer-foot">' +
          '<div class="flouvia-drawer-count" data-fqd-count></div>' +
          '<button type="button" class="flouvia-btn primary flouvia-drawer-req" data-fqd-request>Solicitar cotización</button>' +
          '<button type="button" class="flouvia-drawer-clear" data-fqd-clear>Vaciar lista</button>' +
        '</div>' +
      '</aside>' +
    '</div>';

  function renderDrawer() {
    if (!drawerEls.body) return;
    var items = FlouviaStore.read();
    var count = FlouviaStore.count();
    // Insignia y visibilidad del botón disparador
    if (drawerEls.badge) {
      drawerEls.badge.textContent = count;
      drawerEls.badge.style.display = count > 0 ? '' : 'none';
    }
    if (drawerEls.toggle && drawerEls.toggle.__hideWhenEmpty) {
      drawerEls.toggle.style.display = count > 0 ? '' : 'none';
    }
    // Cuerpo
    if (!items.length) {
      drawerEls.body.innerHTML =
        '<div class="flouvia-empty">' +
          '<div class="flouvia-empty-ic">🛒</div>' +
          '<div class="flouvia-empty-t">Tu cotización está vacía</div>' +
          '<div class="flouvia-empty-d">Agrega productos con el botón “Agregar a cotización” y aparecerán aquí.</div>' +
        '</div>';
    } else {
      drawerEls.body.innerHTML = items.map(function (it) {
        var img = it.image
          ? '<img class="flouvia-pimg" src="' + it.image + '" alt="" />'
          : '<div class="flouvia-pimg"></div>';
        return '<div class="flouvia-prow">' + img +
          '<div class="flouvia-pinfo">' +
            '<div class="flouvia-pname">' + escapeHtml(it.title) + '</div>' +
            (it.variantTitle ? '<div class="flouvia-pvar">' + escapeHtml(it.variantTitle) + '</div>' : '') +
          '</div>' +
          '<div class="flouvia-qty">' +
            '<button type="button" data-fqd-dec="' + it.variantId + '">−</button>' +
            '<input type="number" min="1" value="' + it.quantity + '" data-fqd-qty="' + it.variantId + '" />' +
            '<button type="button" data-fqd-inc="' + it.variantId + '">+</button>' +
          '</div>' +
          '<button type="button" class="flouvia-remove" data-fqd-rm="' + it.variantId + '" aria-label="Quitar">&times;</button>' +
        '</div>';
      }).join('');
    }
    // Pie
    if (drawerEls.count) drawerEls.count.textContent = count === 1 ? '1 producto' : count + ' productos';
    if (drawerEls.request) drawerEls.request.disabled = count === 0;
    if (drawerEls.clear) drawerEls.clear.style.display = count > 0 ? '' : 'none';
  }

  function openDrawer() {
    if (!drawerEls.overlay) return;
    renderDrawer();
    drawerEls.overlay.classList.add('open');
    drawerEls.overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    if (!drawerEls.overlay) return;
    drawerEls.overlay.classList.remove('open');
    drawerEls.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function buildDrawer() {
    if (drawerEls.overlay) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = DRAWER_HTML;
    var overlay = wrap.firstElementChild;
    document.body.appendChild(overlay);
    drawerEls.overlay = overlay;
    drawerEls.panel = overlay.querySelector('.flouvia-drawer');
    drawerEls.body = overlay.querySelector('[data-fqd-body]');
    drawerEls.count = overlay.querySelector('[data-fqd-count]');
    drawerEls.request = overlay.querySelector('[data-fqd-request]');
    drawerEls.clear = overlay.querySelector('[data-fqd-clear]');

    overlay.querySelector('[data-fqd-close]').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDrawer(); });
    drawerEls.request.addEventListener('click', function () {
      if (FlouviaStore.count() === 0) return;
      closeDrawer();
      open({ source: 'quote' });
    });
    drawerEls.clear.addEventListener('click', function () { FlouviaStore.clear(); });
    drawerEls.body.addEventListener('click', function (e) {
      var t = e.target, id;
      if ((id = t.getAttribute('data-fqd-inc')) != null) { var n = +id; FlouviaStore.setQty(n, qtyOf(n) + 1); }
      else if ((id = t.getAttribute('data-fqd-dec')) != null) { var m = +id; FlouviaStore.setQty(m, qtyOf(m) - 1); }
      else if ((id = t.getAttribute('data-fqd-rm')) != null) { FlouviaStore.remove(+id); }
    });
    drawerEls.body.addEventListener('change', function (e) {
      var id = e.target.getAttribute('data-fqd-qty');
      if (id != null) { var q = parseInt(e.target.value, 10); FlouviaStore.setQty(+id, (isNaN(q) || q < 1) ? 1 : q); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeDrawer();
    });
    onStoreRerender();
  }
  function qtyOf(variantId) {
    var items = FlouviaStore.read();
    for (var i = 0; i < items.length; i++) { if (items[i].variantId === variantId) return items[i].quantity; }
    return 1;
  }
  function onStoreRerender() { storeSubs.push(function () { renderDrawer(); }); }

  // ---------- Botón / pestaña disparador del drawer ----------
  function initDrawer(opts) {
    opts = opts || {};
    OPEN_DRAWER_ON_ADD = !!opts.openOnAdd;
    buildDrawer();
    if (opts.title) { var tt = drawerEls.overlay.querySelector('[data-fqd-title]'); if (tt) tt.textContent = opts.title; }
    if (opts.accent) drawerEls.panel.style.setProperty('--fq-accent', opts.accent);
    if (opts.width) drawerEls.panel.style.maxWidth = opts.width + 'px';

    if (drawerEls.toggle) return;   // no duplicar
    var side = opts.side === 'left' ? 'left' : 'right';
    var style = opts.style === 'bubble' ? 'bubble' : 'tab';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flouvia-qtoggle';
    btn.setAttribute('data-style', style);
    btn.setAttribute('data-side', side);
    btn.style.background = opts.bg || cfg('accent');
    btn.style.color = opts.color || '#ffffff';
    var icon = opts.icon != null && opts.icon !== '' ? opts.icon : '🧾';
    btn.innerHTML =
      '<span class="flouvia-qtoggle-ic">' + escapeHtml(icon) + '</span>' +
      '<span class="flouvia-qtoggle-lbl">' + escapeHtml(opts.label || 'Cotización') + '</span>' +
      '<span class="flouvia-qtoggle-badge" data-fqd-badge>0</span>';
    btn.__hideWhenEmpty = !!opts.hideWhenEmpty;
    btn.addEventListener('click', openDrawer);
    document.body.appendChild(btn);
    drawerEls.toggle = btn;
    drawerEls.badge = btn.querySelector('[data-fqd-badge]');
    renderDrawer();   // pinta contador inicial
  }

  // ---------- Botón "Agregar a cotización" en la página de producto ----------
  function initProductAdd(opts) {
    opts = opts || {};
    var handle = handleFromUrl(location.pathname);
    if (!handle && !state.fallbackPreset) return;   // no es página de producto
    var form = opts.selector ? document.querySelector(opts.selector) : null;
    if (!form) form = document.querySelector('form[action*="/cart/add"]');
    var host = form ? (form.querySelector('.product-form__buttons') || form) : null;
    if (!host || host.querySelector('.flouvia-add-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flouvia-add-btn';
    btn.setAttribute('data-flouvia-add', 'current');
    btn.style.background = opts.bg || cfg('accent');
    btn.style.color = opts.color || '#ffffff';
    if (opts.radius != null) btn.style.borderRadius = opts.radius + 'px';
    if (opts.weight) btn.style.fontWeight = opts.weight;
    if (opts.paddingY != null) btn.style.padding = opts.paddingY + 'px ' + (opts.paddingX != null ? opts.paddingX : 22) + 'px';
    if (opts.fullWidth !== false) btn.style.width = '100%';
    btn.textContent = opts.label || 'Agregar a cotización';
    host.appendChild(btn);
  }

  // ---------- Botones "Agregar a cotización" en tarjetas de producto ----------
  function initQuoteCards(opts) {
    opts = opts || {};
    var sel = (opts.selector && opts.selector.trim()) || DEFAULT_CARD_SELECTOR;
    function scan() {
      var cards;
      try { cards = document.querySelectorAll(sel); } catch (e) { return; }
      Array.prototype.forEach.call(cards, function (card) {
        if (card.__flouviaQCard || card.querySelector('.flouvia-qcard-btn')) return;
        var link = card.querySelector('a[href*="/products/"]');
        var handle = link && handleFromUrl(link.getAttribute('href') || link.href);
        if (!handle) return;
        card.__flouviaQCard = true;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flouvia-card-btn flouvia-qcard-btn' + (opts.position === 'overlay' ? ' flouvia-card-btn--overlay' : '');
        btn.setAttribute('data-flouvia-add', 'handle:' + handle);
        btn.style.background = opts.bg || cfg('accent');
        btn.style.color = opts.color || '#ffffff';
        btn.style.borderRadius = (opts.radius != null ? opts.radius : 8) + 'px';
        btn.style.fontSize = (opts.fontSize != null ? opts.fontSize : 13) + 'px';
        btn.style.padding = (opts.paddingY != null ? opts.paddingY : 8) + 'px ' + (opts.paddingX != null ? opts.paddingX : 12) + 'px';
        if (opts.weight) btn.style.fontWeight = opts.weight;
        btn.textContent = opts.label || 'Agregar a cotización';
        if (opts.position === 'overlay') {
          var media = card.querySelector('.card__media, .card__inner, .media, .product-card__image, .grid-product__image');
          var oh = media || card; oh.classList.add('flouvia-card-host'); oh.appendChild(btn);
        } else {
          var info = card.querySelector('.card__content, .card-information, .product-card__info, .grid-product__meta');
          (info || card).appendChild(btn);
        }
      });
    }
    scan();
    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return; pending = true;
        setTimeout(function () { pending = false; scan(); }, 200);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ----------------------------------------------------------- API pública
  window.FlouviaQuote = {
    open: open,
    openFromCart: function () { open({ source: 'cart' }); },
    openProduct: function (handle) { open({ source: 'handle', handle: handle }); },
    initFloating: initFloating,
    initCartButton: initCartButton,
    initCards: initCards,
    initDrawer: initDrawer,
    initProductAdd: initProductAdd,
    initQuoteCards: initQuoteCards,
    openDrawer: openDrawer,
    store: FlouviaStore,
    _captureProductPreset: captureProductPreset
  };

  // Capturar el preset de producto cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', captureProductPreset);
  } else {
    captureProductPreset();
  }
})();
