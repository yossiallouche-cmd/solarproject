/* ======================================================================
   Composants du parcours de commande
   - <clarte-pricebox>      prix fourniture / pose / total (fiche produit)
   - <clarte-installation>  délai de pose standard / express
   - <clarte-configurator>  configurateur carport (variantes ou sur mesure)
   - <clarte-clim-advisor>  conseil de dimensionnement climatisation
   - <clarte-simulator>     simulateur d'économies solaires
   - <clarte-rdv>           créneau d'appel technique + date de pose (panier)
   ====================================================================== */

const fmtMoney = (cents, { withDecimals = false } = {}) => {
  const value = cents / 100;
  const hasDecimals = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: hasDecimals || withDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals || withDecimals ? 2 : 0
  }).format(value);
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);

/* ---------- Ajouts au panier liés au produit principal -------------------
   Les composants (pose express, panneaux du carport sur mesure…) s'enregistrent ici.
   Au clic sur « Ajouter au panier », on valide, on ajoute d'abord leurs lignes, puis on laisse le thème
   ajouter le produit principal. */
/* Dernier état connu (puissance, prix), pour les composants initialisés après coup */
const ClarteLast = { solar: null, price: null };
document.addEventListener('clarte:solar:change', (e) => { ClarteLast.solar = e.detail; });
document.addEventListener('clarte:price:change', (e) => { ClarteLast.price = e.detail; });

const ClarteAddons = {
  providers: new Set(),
  register(p) { this.providers.add(p); },
  unregister(p) { this.providers.delete(p); }
};
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const provs = [...ClarteAddons.providers].filter((p) => p.form === form);
  if (!provs.length) return;
  if (form.dataset.clarteBypass === '1') { delete form.dataset.clarteBypass; return; }
  for (const p of provs) {
    if (p.validate && p.validate() === false) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  }
  const items = provs.flatMap((p) => (p.items ? p.items() : []));
  if (!items.length) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const buttons = Array.from(form.elements).filter((el) => el.type === 'submit');
  buttons.forEach((el) => el.setAttribute('aria-busy', 'true'));
  try {
    await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ items })
    });
  } catch (e) { /* le produit principal doit être ajouté quoi qu'il arrive */ }
  buttons.forEach((el) => el.removeAttribute('aria-busy'));
  form.dataset.clarteBypass = '1';
  form.requestSubmit();
}, true);

/* Sélectionne des valeurs d'option dans le sélecteur de variantes du thème (retrouvées par le texte du label). */
const clarteSelectOptions = (form, values) => {
  if (!form) return;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  values.forEach((value, i) => {
    if (value == null) return;
    const inputs = Array.from(document.querySelectorAll(`input[data-option-position="${i + 1}"][form="${form.getAttribute('id')}"]`));
    const input = inputs.find((el) => el.value === value)
      || inputs.find((el) => { const l = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); return l && norm(l.textContent) === norm(value); });
    if (input && !input.checked) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
  });
};

/* ---------- Bloc prix produit ------------------------------------------- */
class ClartePricebox extends HTMLElement {
  connectedCallback() {
    this.form = document.forms[this.getAttribute('form')];
    try { this.map = JSON.parse(this.querySelector('script[data-variants]')?.textContent || '{}'); } catch (e) { this.map = {}; }
    this.extras = new Map(); // suppléments : pose express, panneaux… { label, cents }
    this.extrasBox = this.querySelector('[data-extras]');
    this.out = {};
    this.querySelectorAll('[data-out]').forEach((el) => { this.out[el.dataset.out] = el; });

    this._onVariant = (e) => { if (e.detail?.variant?.id) this.render(e.detail.variant.id); };
    this.form?.addEventListener('variant:change', this._onVariant);
    this._onExtra = (e) => {
      const d = e.detail || {};
      if (d.form && d.form !== this.form) return;
      if (d.cents > 0) this.extras.set(d.key, { label: d.label, cents: d.cents }); else this.extras.delete(d.key);
      this.render(this.currentId);
    };
    document.addEventListener('clarte:extra:change', this._onExtra);

    this.currentId = this.form?.id?.value || this.dataset.variant;
    this.render(this.currentId);
    document.dispatchEvent(new CustomEvent('clarte:pricebox:ready', { detail: { form: this.form } }));
  }

  disconnectedCallback() {
    this.form?.removeEventListener('variant:change', this._onVariant);
    document.removeEventListener('clarte:extra:change', this._onExtra);
  }

  render(variantId) {
    const v = this.map[variantId];
    if (!v) return;
    this.currentId = variantId;
    let total = v.t;
    if (this.out.fourniture) this.out.fourniture.textContent = fmtMoney(v.f);
    if (this.out.pose) this.out.pose.textContent = fmtMoney(v.p);
    if (this.extrasBox) {
      this.extrasBox.innerHTML = '';
      this.extras.forEach((x) => {
        total += x.cents;
        const line = document.createElement('div');
        line.className = 'cl-price-line';
        const label = document.createElement('span'); label.textContent = x.label;
        const amount = document.createElement('span'); amount.className = 'cl-amount'; amount.textContent = fmtMoney(x.cents);
        line.append(label, amount);
        this.extrasBox.appendChild(line);
      });
    }
    if (this.out.total) this.out.total.textContent = fmtMoney(total);
    document.dispatchEvent(new CustomEvent('clarte:price:change', { detail: { form: this.form, totalCents: total } }));
  }
}
if (!customElements.get('clarte-pricebox')) customElements.define('clarte-pricebox', ClartePricebox);

/* ---------- Délai de pose : standard / express -------------------------- */
class ClarteInstallation extends HTMLElement {
  connectedCallback() {
    this.formId = this.getAttribute('form');
    this.form = document.forms[this.formId];
    this.expressVariant = this.dataset.expressVariant;
    this.expressPrice = parseInt(this.dataset.expressPrice || '0', 10);
    this.radios = Array.from(this.querySelectorAll('input[type="radio"][data-delay]'));
    this.consentBox = this.querySelector('[data-consent]');
    this.consent = this.querySelector('input[data-consent-input]');
    this.error = this.querySelector('[data-error]');
    this.propertyDelay = this.querySelector('input[data-prop="delay"]');
    this.propertyConsent = this.querySelector('input[data-prop="consent"]');

    this.radios.forEach((r) => r.addEventListener('change', () => this.update()));
    this.consent?.addEventListener('change', () => this.update());

    this.expressLabel = this.dataset.expressLabel || 'Pose express';
    ClarteAddons.register(this);
    this._onReady = () => this.update();
    document.addEventListener('clarte:pricebox:ready', this._onReady);
    this.update();
  }

  disconnectedCallback() { ClarteAddons.unregister(this); document.removeEventListener('clarte:pricebox:ready', this._onReady); }

  validate() {
    if (!this.isExpress || this.consent?.checked) return true;
    this.error?.setAttribute('data-visible', '');
    this.consent?.focus();
    return false;
  }

  items() {
    if (!this.isExpress || !this.expressVariant) return [];
    return [{ id: parseInt(this.expressVariant, 10), quantity: 1, properties: { 'Pour': this.dataset.productTitle || '' } }];
  }

  get isExpress() { return this.radios.find((r) => r.checked)?.dataset.delay === 'express'; }

  update() {
    const express = this.isExpress;
    if (this.consentBox) { if (express) this.consentBox.setAttribute('data-visible', ''); else this.consentBox.removeAttribute('data-visible'); }
    if (!express) { if (this.consent) this.consent.checked = false; }
    if (!express || this.consent?.checked) this.error?.removeAttribute('data-visible');
    const checked = this.radios.find((r) => r.checked);
    if (this.propertyDelay) this.propertyDelay.value = checked?.dataset.label || '';
    if (this.propertyConsent) {
      this.propertyConsent.value = express && this.consent?.checked ? (this.consent.dataset.label || 'Oui') : '';
      this.propertyConsent.disabled = !(express && this.consent?.checked);
    }
    document.dispatchEvent(new CustomEvent('clarte:extra:change', { detail: { form: this.form, key: 'express', label: this.expressLabel, cents: express ? this.expressPrice : 0 } }));
  }
}
if (!customElements.get('clarte-installation')) customElements.define('clarte-installation', ClarteInstallation);

/* ---------- Panier : rendez-vous --------------------------------------- */
class ClarteRdv extends HTMLElement {
  connectedCallback() {
    this.callHours = parseInt(this.dataset.callHours || '48', 10);
    this.firstDay = parseInt(this.dataset.firstDay || '3', 10);
    this.lastDay = parseInt(this.dataset.lastDay || '14', 10);
    this.express = this.dataset.express === 'true';
    this.slotsBox = this.querySelector('[data-slots]');
    this.dateInput = this.querySelector('input[data-date]');
    this.buildSlots();
    this.buildDates();
    this.querySelectorAll('input, select').forEach((el) => el.addEventListener('change', () => this.save()));
  }

  nextBusinessDays(fromOffset, count) {
    const days = []; const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + fromOffset);
    while (days.length < count) { if (d.getDay() !== 0) days.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return days;
  }

  fmtDay(d) { return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); }
  iso(d) { return d.toISOString().slice(0, 10); }

  buildSlots() {
    if (!this.slotsBox) return;
    const days = this.nextBusinessDays(1, this.express ? 1 : 2);
    const periods = [['Matin', '9 h – 12 h'], ['Après-midi', '14 h – 18 h']];
    const current = this.slotsBox.dataset.current || '';
    let html = '';
    days.forEach((d) => periods.forEach(([p, h]) => {
      const value = `${this.fmtDay(d)} · ${p} (${h})`;
      html += `<label class="cl-rdv__slot"><input type="radio" name="attributes[Créneau d'appel technique]" value="${value}" ${value === current ? 'checked' : ''}><span><strong>${this.fmtDay(d)}</strong><small>${p} · ${h}</small></span></label>`;
    }));
    this.slotsBox.innerHTML = html;
  }

  buildDates() {
    if (!this.dateInput) return;
    const first = this.nextBusinessDays(this.express ? 1 : this.firstDay, 1)[0];
    const last = new Date(); last.setDate(last.getDate() + (this.express ? 3 : this.lastDay));
    this.dateInput.min = this.iso(first);
    this.dateInput.max = this.iso(last);
    if (!this.dateInput.value) this.dateInput.value = this.iso(first);
    const hint = this.querySelector('[data-date-hint]');
    if (hint) hint.textContent = `Entre le ${first.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} et le ${last.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}. Confirmée lors de l'appel technique.`;
    this.save();
  }

  async save() {
    const attributes = {};
    // La date est recopiée en français dans un champ caché (c'est lui qui part au checkout)
    const hiddenDate = this.querySelector('input[data-date-attribute]');
    if (this.dateInput && hiddenDate) {
      hiddenDate.value = this.dateInput.value
        ? new Date(this.dateInput.value + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : '';
    }
    this.querySelectorAll('[name^="attributes["]').forEach((el) => {
      if (el.type === 'radio' && !el.checked) return;
      attributes[el.name.slice(11, -1)] = el.value;
    });
    try {
      await fetch(`${window.Shopify?.routes?.root || '/'}cart/update.js`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attributes })
      });
    } catch (e) { /* silencieux : les attributs partent aussi avec le formulaire */ }
  }
}
if (!customElements.get('clarte-rdv')) customElements.define('clarte-rdv', ClarteRdv);

/* ---------- Configurateur visuel (fiche produit) ------------------------ */
class ClarteConfigurator extends HTMLElement {
  connectedCallback() {
    this.form = document.forms[this.getAttribute('form')];
    try { this.data = JSON.parse(this.querySelector('script[data-product]')?.textContent || '{}'); } catch (e) { this.data = null; }
    if (!this.data || !this.data.options) return;
    this.box = this.querySelector('[data-options]');
    this.svg = this.querySelector('[data-svg]');
    this.facts = this.querySelector('[data-facts]');
    this.selection = [...(this.data.selected || [])];
    this.custom = this.hasAttribute('data-custom');
    if (this.custom) { this.initCustom(); return; }
    this.build();
    this.refresh(false);
  }

  disconnectedCallback() { ClarteAddons.unregister(this); document.removeEventListener('clarte:pricebox:ready', this._onReady); }

  /* ----- Mode sur mesure : largeur, profondeur, nombre de panneaux ----- */
  initCustom() {
    const d = this.dataset;
    const int = (v, f) => { const n = parseInt(v, 10); return isNaN(n) ? f : n; };
    this.cfg = {
      wMin: int(d.widthMin, 250), wMax: int(d.widthMax, 750), dMin: int(d.depthMin, 450), dMax: int(d.depthMax, 700),
      step: int(d.step, 10), pw: int(d.panelWidth, 114), ph: int(d.panelHeight, 180), wc: int(d.panelWc, 450),
      pMin: int(d.panelMin, 2), panelVariant: d.panelVariant, panelPrice: int(d.panelPrice, 0), panelLabel: d.panelLabel || 'Panneaux solaires posés'
    };
    // Variantes « Surface » triées par surface croissante
    this.brackets = this.data.variants
      .map((v) => ({ v, s: ClarteConfigurator.num(v.options[0]) }))
      .filter((x) => !isNaN(x.s)).sort((a, b) => a.s - b.s);
    // Dimensions de départ : celles qui correspondent à la variante affichée (pas de changement de variante au chargement)
    const current = this.brackets.find((x) => x.v.options[0] === this.selection[0]) || this.brackets[0];
    this.state = { ...this.dimsFor(current ? current.s : 0), n: 0, auto: true };

    const m = (cm) => `${(cm / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
    this.fmtM = m;
    const row = (key, label, min, max, step) => `
      <div class="cl-range" data-row="${key}">
        <div class="cl-range__head"><label for="clc-${key}">${label}</label>
          <span class="cl-stepper"><button type="button" data-dec aria-label="Diminuer">−</button><output></output><button type="button" data-inc aria-label="Augmenter">+</button></span>
        </div>
        <input id="clc-${key}" class="range" type="range" min="${min}" max="${max}" step="${step}">
        <div class="cl-range__scale"><span data-min></span><span data-max></span></div>
      </div>`;
    this.box.innerHTML = row('w', 'Largeur', this.cfg.wMin, this.cfg.wMax, this.cfg.step)
      + row('d', 'Profondeur', this.cfg.dMin, this.cfg.dMax, this.cfg.step)
      + row('n', 'Panneaux solaires', 0, 1, 1);
    this.rows = {};
    this.box.querySelectorAll('[data-row]').forEach((el) => {
      const key = el.dataset.row;
      const input = el.querySelector('input');
      this.rows[key] = { el, input, out: el.querySelector('output'), min: el.querySelector('[data-min]'), max: el.querySelector('[data-max]') };
      const set = (value) => {
        const lo = parseInt(input.min, 10), hi = parseInt(input.max, 10);
        this.state[key] = Math.min(hi, Math.max(lo, value));
        if (key === 'n') this.state.auto = this.state.n >= hi;
        this.updateCustom(true);
      };
      input.addEventListener('input', () => set(parseInt(input.value, 10)));
      el.querySelector('[data-dec]').addEventListener('click', () => set(this.state[key] - parseInt(input.step, 10)));
      el.querySelector('[data-inc]').addEventListener('click', () => set(this.state[key] + parseInt(input.step, 10)));
    });
    this.props = {};
    this.querySelectorAll('input[data-prop]').forEach((el) => { this.props[el.dataset.prop] = el; });

    ClarteAddons.register(this);
    this._onReady = () => this.updateCustom(false);
    document.addEventListener('clarte:pricebox:ready', this._onReady);
    this.updateCustom(false);
  }

  /* Dimensions (multiples du pas) dont la surface tombe dans la tranche demandée */
  dimsFor(surface) {
    const { wMin, wMax, dMin, dMax, step } = this.cfg;
    const fits = (w, d) => Math.ceil(w * d / 10000 - 1e-6) === surface;
    const depths = [500, dMin];
    for (let d = dMin; d <= dMax; d += step) depths.push(d);
    for (const d of depths) {
      if (d < dMin || d > dMax) continue;
      for (let w = wMax; w >= wMin; w -= step) if (fits(w, d)) return { w, d };
    }
    return { w: wMin, d: dMin };
  }

  /* Calepinage : on retient l'orientation des panneaux (portrait ou paysage) qui en loge le plus */
  layout() {
    const { w, d } = this.state, { pw, ph } = this.cfg;
    const a = { cols: Math.floor(w / pw), rows: Math.floor(d / ph) };
    const b = { cols: Math.floor(w / ph), rows: Math.floor(d / pw) };
    this._portrait = a;
    return b.cols * b.rows > a.cols * a.rows ? b : a;
  }

  maxPanels() { const l = this.layout(); return l.cols * l.rows; }

  items() {
    if (!this.custom || !this.cfg.panelVariant || this.state.n < 1) return [];
    return [{ id: parseInt(this.cfg.panelVariant, 10), quantity: this.state.n,
      properties: { 'Pour': this.dataset.productTitle || '', 'Dimensions': `${this.fmtM(this.state.w)} × ${this.fmtM(this.state.d)}` } }];
  }

  updateCustom(propagate) {
    const { cfg, state, rows } = this;
    const max = this.maxPanels();
    const min = Math.min(cfg.pMin, max);
    if (state.auto || state.n > max) state.n = max;
    if (state.n < min) state.n = min;
    rows.n.input.min = min; rows.n.input.max = max;
    const surface = (state.w / 100) * (state.d / 100);
    const kwc = Math.round(state.n * cfg.wc / 100) / 10;

    rows.w.input.value = state.w; rows.d.input.value = state.d; rows.n.input.value = state.n;
    rows.w.out.textContent = this.fmtM(state.w); rows.d.out.textContent = this.fmtM(state.d);
    rows.n.out.textContent = `${state.n} · ${kwc.toLocaleString('fr-FR')} kWc`;
    rows.w.min.textContent = this.fmtM(cfg.wMin); rows.w.max.textContent = this.fmtM(cfg.wMax);
    rows.d.min.textContent = this.fmtM(cfg.dMin); rows.d.max.textContent = this.fmtM(cfg.dMax);
    rows.n.min.textContent = `${min} panneaux`; rows.n.max.textContent = `${max} panneaux maximum`;

    if (this.props.width) this.props.width.value = this.fmtM(state.w);
    if (this.props.depth) this.props.depth.value = this.fmtM(state.d);
    if (this.props.surface) this.props.surface.value = `${surface.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m²`;
    if (this.props.panels) this.props.panels.value = `${state.n} (${kwc.toLocaleString('fr-FR')} kWc)`;

    // Variante = première tranche de surface qui couvre la surface demandée
    const bracket = this.brackets.find((x) => x.s >= surface - 1e-6) || this.brackets[this.brackets.length - 1];
    if (bracket && propagate) this.syncTheme(bracket.v);

    const lay = this.layout();
    const cols = Math.max(1, lay.cols), rws = Math.max(1, lay.rows);
    const portrait = lay === this._portrait;
    this.drawScene({ width: state.w / 100, depth: state.d / 100, cars: state.w >= 500 ? 2 : 1, cols, rows: rws, panels: state.n, kwc,
      cellW: (portrait ? cfg.pw : cfg.ph) / 100, cellH: (portrait ? cfg.ph : cfg.pw) / 100 });

    document.dispatchEvent(new CustomEvent('clarte:extra:change', { detail: { form: this.form, key: 'panels', label: `${cfg.panelLabel} (${state.n})`, cents: state.n * cfg.panelPrice } }));
    document.dispatchEvent(new CustomEvent('clarte:solar:change', { detail: { form: this.form, kwc, panels: state.n } }));
  }

  static num(value) {
    const m = String(value).replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  build() {
    this.box.innerHTML = '';
    this.data.options.forEach((opt, i) => {
      const numeric = opt.values.length > 2 && opt.values.every((v) => !isNaN(ClarteConfigurator.num(v)));
      const wrap = document.createElement('div');
      wrap.className = 'cl-config__opt';
      if (numeric) {
        const values = [...opt.values].sort((a, b) => ClarteConfigurator.num(a) - ClarteConfigurator.num(b));
        const idx = Math.max(0, values.indexOf(this.selection[i]));
        wrap.innerHTML = `
          <div class="cl-range">
            <div class="cl-range__head"><label>${opt.name}</label><output>${values[idx]}</output></div>
            <input class="range" type="range" min="0" max="${values.length - 1}" step="1" value="${idx}" aria-label="${opt.name}">
            <div class="cl-range__scale"><span>${values[0]}</span><span>${values[values.length - 1]}</span></div>
          </div>`;
        const input = wrap.querySelector('input');
        const out = wrap.querySelector('output');
        input.addEventListener('input', () => { out.textContent = values[input.value]; this.selection[i] = values[input.value]; this.refresh(true); });
      } else {
        wrap.innerHTML = `<p class="cl-config__opt-label">${opt.name}</p><div class="cl-config__cards"></div>`;
        const cards = wrap.querySelector('.cl-config__cards');
        opt.values.forEach((v) => {
          const label = document.createElement('label');
          label.className = 'cl-config__card';
          label.innerHTML = `<input type="radio" name="clcfg-${i}" value="${v}" ${v === this.selection[i] ? 'checked' : ''}><span>${v}</span>`;
          label.querySelector('input').addEventListener('change', () => { this.selection[i] = v; this.refresh(true); });
          cards.appendChild(label);
        });
      }
      this.box.appendChild(wrap);
    });
  }

  get variant() {
    return this.data.variants.find((v) => v.options.every((o, i) => o === this.selection[i]))
      || this.data.variants.find((v) => v.options[0] === this.selection[0]);
  }

  refresh(propagate) {
    const v = this.variant;
    this.draw(v);
    this.querySelectorAll('.cl-config__card').forEach((c) => c.classList.toggle('is-unavailable', false));
    if (propagate && v) this.syncTheme(v);
  }

  syncTheme(v) { clarteSelectOptions(this.form, v.options); }

  dims() {
    // Largeur / profondeur : premières options numériques en mètres ; places : option contenant « voiture »
    let width = NaN, depth = NaN, cars = NaN;
    this.data.options.forEach((opt, i) => {
      const n = ClarteConfigurator.num(this.selection[i]);
      const name = opt.name.toLowerCase();
      if (/larg/.test(name)) width = n;
      else if (/prof|long/.test(name)) depth = n;
      else if (/voiture|place/.test(name) || /voiture|place/.test(String(this.selection[i]).toLowerCase())) cars = isNaN(n) ? 1 : n;
    });
    if (isNaN(cars)) cars = isNaN(width) ? 1 : (width >= 5 ? 2 : 1);
    if (isNaN(width)) width = cars === 2 ? 6 : 3;
    if (isNaN(depth)) depth = 5;
    return { width, depth, cars };
  }

  draw(v) {
    const { width, depth, cars } = this.dims();
    const cols = Math.max(1, Math.round(width / 1.15));
    const rows = Math.max(1, Math.round(depth / 1.95));
    const panels = v && v.panels ? v.panels : cols * rows;
    const kwc = v && v.kwc ? v.kwc : Math.round(panels * 0.45 * 10) / 10;
    this.drawScene({ width, depth, cars, cols, rows, panels, kwc });
    document.dispatchEvent(new CustomEvent('clarte:solar:change', { detail: { form: this.form, kwc, panels } }));
  }

  drawScene({ width, depth, cars, cols, rows, panels, kwc, cellW, cellH }) {

    if (this.facts) {
      this.facts.innerHTML = `
        <span><strong>${width.toLocaleString('fr-FR')} × ${depth.toLocaleString('fr-FR')} m</strong><small>${(width * depth).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m² couverts</small></span>
        <span><strong>${panels}</strong><small>panneaux</small></span>
        <span><strong>${kwc.toLocaleString('fr-FR')} kWc</strong><small>puissance</small></span>
        <span><strong>${cars}</strong><small>${cars > 1 ? 'voitures' : 'voiture'}</small></span>`;
    }
    if (!this.svg) return;

    const scale = Math.min(300 / Math.max(width, 3), 200 / Math.max(depth, 4));
    const W = width * scale, D = depth * scale;
    const x0 = (400 - W) / 2, y0 = (260 - D) / 2;
    const gap = 3;
    // Panneaux à l'échelle (sur mesure) ou répartis sur toute la toiture (variantes)
    const real = cellW > 0 && cellH > 0;
    const pw = real ? cellW * scale - gap : (W - gap * (cols + 1)) / cols;
    const ph = real ? cellH * scale - gap : (D - gap * (rows + 1)) / rows;
    const ox = real ? x0 + (W - cols * (pw + gap) + gap) / 2 - gap : x0;
    const oy = real ? y0 + (D - rows * (ph + gap) + gap) / 2 - gap : y0;
    let cells = '';
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = n < panels; n++;
      cells += `<rect x="${(ox + gap + c * (pw + gap)).toFixed(1)}" y="${(oy + gap + r * (ph + gap)).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="2" fill="${on ? 'rgb(var(--text-color))' : 'rgb(var(--text-color) / .12)'}" />`;
    }
    let carsSvg = '';
    const carW = Math.min(W / cars - 14, 2.1 * scale), carH = Math.min(D - 30, 4.4 * scale);
    for (let i = 0; i < cars; i++) {
      const cx = x0 + (W / cars) * (i + 0.5) - carW / 2, cy = y0 + (D - carH) / 2;
      carsSvg += `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${carW.toFixed(1)}" height="${carH.toFixed(1)}" rx="${(carW / 4).toFixed(1)}" fill="rgb(var(--cl-accent))" opacity=".9"/>
        <rect x="${(cx + carW * 0.15).toFixed(1)}" y="${(cy + carH * 0.22).toFixed(1)}" width="${(carW * 0.7).toFixed(1)}" height="${(carH * 0.28).toFixed(1)}" rx="3" fill="rgb(var(--text-color))" opacity=".25"/>`;
    }
    this.svg.innerHTML = `
      <rect x="${(x0 - 6).toFixed(1)}" y="${(y0 - 6).toFixed(1)}" width="${(W + 12).toFixed(1)}" height="${(D + 12).toFixed(1)}" rx="8" fill="none" stroke="rgb(var(--text-color) / .2)"/>
      <g opacity=".35">${carsSvg}</g>
      <g>${cells}</g>
      <text x="200" y="${(y0 - 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65">${width.toLocaleString('fr-FR')} m</text>
      <text x="${(x0 - 14).toFixed(1)}" y="130" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65" transform="rotate(-90 ${(x0 - 14).toFixed(1)} 130)">${depth.toLocaleString('fr-FR')} m</text>`;
  }
}
if (!customElements.get('clarte-configurator')) customElements.define('clarte-configurator', ClarteConfigurator);


/* ---------- Conseil climatisation ---------------------------------------
   Deux questions qui s'enchaînent sans bouton « suivant » : chaque réponse affiche la question suivante,
   puis la configuration conseillée est sélectionnée dans les options du produit. */
class ClarteClimAdvisor extends HTMLElement {
  connectedCallback() {
    this.form = document.forms[this.getAttribute('form')];
    try { this.data = JSON.parse(this.querySelector('script[data-product]')?.textContent || '{}'); } catch (e) { this.data = {}; }
    const opts = this.data.options || [];
    this.roomsIdx = opts.findIndex((o) => /pi[eè]ce|split/i.test(o.name) && !/puissance/i.test(o.name));
    this.powerIdx = opts.findIndex((o) => /puissance|kw/i.test(o.name));
    if (this.powerIdx < 0) { this.hidden = true; return; }
    this.wpm = parseFloat(this.dataset.wattsPerM2 || '100');
    this.surfaces = (this.dataset.surfaces || '20,25,35,50,70').split(',').map((s) => parseFloat(s)).filter((n) => n > 0).sort((a, b) => a - b);
    this.stepsBox = this.querySelector('[data-steps]');
    this.resultBox = this.querySelector('[data-result]');
    this.answers = {};
    this.render();
  }

  static num(value) { const m = String(value).replace(',', '.').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; }

  choices(name, legend, items) {
    const fs = document.createElement('fieldset');
    fs.className = 'cl-advisor__step';
    fs.innerHTML = `<legend>${legend}</legend><div class="cl-advisor__choices"></div>`;
    const box = fs.querySelector('.cl-advisor__choices');
    items.forEach((it, i) => {
      const id = `${this.id || 'cla'}-${name}-${i}`;
      const input = document.createElement('input');
      input.type = 'radio'; input.name = `${this.id || 'cla'}-${name}`; input.id = id; input.className = 'sr-only';
      input.checked = this.answers[name] === it.value;
      const label = document.createElement('label');
      label.className = 'block-swatch'; label.htmlFor = id; label.textContent = it.label;
      input.addEventListener('change', () => this.answer(name, it.value));
      box.append(input, label);
    });
    return fs;
  }

  answer(name, value) {
    this.answers[name] = value;
    if (name === 'rooms') delete this.answers.surface;
    this.render(true);
  }

  render(scroll) {
    const opts = this.data.options;
    this.stepsBox.innerHTML = '';
    this.resultBox.hidden = true;
    const hasRooms = this.roomsIdx >= 0;

    if (hasRooms) {
      const items = opts[this.roomsIdx].values.map((v) => ({ value: v, label: String(ClarteClimAdvisor.num(v)) }));
      items.push({ value: '__more', label: `${items.length + 1} et +` });
      this.stepsBox.appendChild(this.choices('rooms', this.dataset.qRooms, items));
      if (this.answers.rooms === '__more') {
        this.resultBox.hidden = false;
        this.resultBox.innerHTML = `<p>${this.dataset.moreText || ''}</p>`;
        return;
      }
    }
    if (!hasRooms || this.answers.rooms) {
      let prev = 0;
      const items = this.surfaces.map((s) => { const label = prev ? `${prev} à ${s} m²` : `Jusqu’à ${s} m²`; prev = s; return { value: s, label }; });
      const step = this.choices('surface', this.dataset.qSurface, items);
      this.stepsBox.appendChild(step);
      if (scroll && this.answers.surface == null) step.classList.add('is-entering');
    }
    if (this.answers.surface != null) this.recommend();
  }

  recommend() {
    const opts = this.data.options;
    const need = this.answers.surface * this.wpm / 1000;
    const rooms = this.roomsIdx >= 0 ? this.answers.rooms : null;
    // Puissances réellement disponibles pour ce nombre de pièces
    const powers = [...new Set(this.data.variants
      .filter((v) => rooms == null || v.options[this.roomsIdx] === rooms)
      .map((v) => v.options[this.powerIdx]))]
      .map((label) => ({ label, kw: ClarteClimAdvisor.num(label) }))
      .filter((x) => !isNaN(x.kw)).sort((a, b) => a.kw - b.kw);
    if (!powers.length) return;
    const pick = powers.find((x) => x.kw >= need - 0.05) || powers[powers.length - 1];
    const enough = pick.kw >= need - 0.05;
    const values = [];
    if (rooms != null) values[this.roomsIdx] = rooms;
    values[this.powerIdx] = pick.label;
    clarteSelectOptions(this.form, values);

    const roomsCount = rooms != null ? ClarteClimAdvisor.num(rooms) : 1;
    const units = `${roomsCount} unité${roomsCount > 1 ? 's' : ''} intérieure${roomsCount > 1 ? 's' : ''}`;
    this.resultBox.hidden = false;
    this.resultBox.innerHTML = `
      <p class="cl-advisor__reco"><span>Notre conseil</span><strong>${units} · ${pick.label}${roomsCount > 1 ? ' pour la pièce principale' : ''}</strong></p>
      <p>${enough ? 'La configuration est sélectionnée, le prix posé est à jour ci-dessous.' : 'Cette pièce demande plus de puissance que ce modèle n’en propose : nous sélectionnons la plus élevée, à valider avec le technicien.'}</p>
      ${this.dataset.note || ''}`;
  }
}
if (!customElements.get('clarte-clim-advisor')) customElements.define('clarte-clim-advisor', ClarteClimAdvisor);

/* ---------- Simulateur d'économies solaires ------------------------------ */
class ClarteSimulator extends HTMLElement {
  connectedCallback() {
    const d = this.dataset;
    const f = (v, fb) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? fb : n; };
    this.p = {
      price: f(d.kwhPrice, 0.2), yield: f(d.yield, 1050), surplus: f(d.surplus, 0.011), inflation: f(d.inflation, 3) / 100,
      rate: f(d.rate, 50) / 100, rateBattery: f(d.rateBattery, 80) / 100, wc: f(d.panelWc, 500), years: 25
    };
    this.productMode = this.hasAttribute('data-product-mode');
    try { this.variants = JSON.parse(this.querySelector('script[data-variants]')?.textContent || '{}'); } catch (e) { this.variants = {}; }
    this.bill = this.querySelector('input[data-bill]');
    this.panels = this.querySelector('input[data-panels]');
    this.battery = this.querySelector('input[data-battery]');
    this.out = {};
    this.querySelectorAll('[data-out]').forEach((el) => { this.out[el.dataset.out] = el; });
    this.kwc = 0;
    this.cost = f(d.cost, 0); // centimes

    [this.bill, this.panels, this.battery].forEach((el) => el?.addEventListener('input', () => this.update()));
    if (this.productMode) {
      const kwcOf = (v) => {
        if (!v) return 0;
        if (v.kwc) return v.kwc;
        const m = String(v.title || '').replace(',', '.').match(/([\d.]+)\s*kWc/i);
        return m ? parseFloat(m[1]) : 0;
      };
      const selected = Object.values(this.variants).find((v) => v.selected);
      this.kwc = kwcOf(selected);
      if (ClarteLast.solar?.kwc != null) this.kwc = ClarteLast.solar.kwc;
      if (ClarteLast.price?.totalCents) this.cost = ClarteLast.price.totalCents;
      this._onVariant = (e) => { const v = this.variants[e.detail?.variant?.id]; if (v) { const k = kwcOf(v); if (k) this.kwc = k; this.cost = v.price; this.update(); } };
      this._onSolar = (e) => { if (e.detail?.kwc != null) { this.kwc = e.detail.kwc; this.update(); } };
      this._onPrice = (e) => { if (e.detail?.totalCents) { this.cost = e.detail.totalCents; this.update(); } };
      document.addEventListener('variant:change', this._onVariant);
      document.addEventListener('clarte:solar:change', this._onSolar);
      document.addEventListener('clarte:price:change', this._onPrice);
    }
    this.update();
  }

  disconnectedCallback() {
    document.removeEventListener('variant:change', this._onVariant);
    document.removeEventListener('clarte:solar:change', this._onSolar);
    document.removeEventListener('clarte:price:change', this._onPrice);
  }

  update() {
    const p = this.p;
    const bill = parseFloat(this.bill?.value || '150');
    const kwc = this.productMode ? this.kwc : Math.round(parseInt(this.panels?.value || '8', 10) * p.wc / 100) / 10;
    const battery = this.battery ? this.battery.checked : this.hasAttribute('data-with-battery');
    const section = this.closest('.shopify-section');
    if (this.productMode && section) section.hidden = !(kwc > 0);
    if (!(kwc > 0)) return;
    const conso = bill * 12 / p.price;
    const prod = kwc * p.yield;
    const auto = Math.min(prod * (battery ? p.rateBattery : p.rate), conso * 0.9);
    const surplus = Math.max(0, prod - auto);
    const first = auto * p.price + surplus * p.surplus;
    let total = 0, payback = null;
    for (let y = 0; y < p.years; y++) {
      const deg = Math.pow(0.995, y);
      total += auto * deg * p.price * Math.pow(1 + p.inflation, y) + surplus * deg * p.surplus;
      if (payback == null && this.cost > 0 && total * 100 >= this.cost) payback = y + 1;
    }
    const set = (k, v) => { if (this.out[k]) this.out[k].textContent = v; };
    set('bill', `${fmtInt(bill)} €`);
    if (this.panels) set('panels', `${this.panels.value} panneaux · ${kwc.toLocaleString('fr-FR')} kWc`);
    set('kwc', `${kwc.toLocaleString('fr-FR')} kWc`);
    set('first', `${fmtInt(Math.round(first / 10) * 10)} €`);
    set('monthly', `${fmtInt(Math.round(first / 12))} €`);
    set('production', `${fmtInt(Math.round(prod / 10) * 10)} kWh`);
    set('coverage', `${Math.round(Math.min(1, auto / conso) * 100)} %`);
    set('total', `${fmtInt(Math.round(total / 100) * 100)} €`);
    if (this.out.payback) {
      const row = this.out.payback.closest('[data-payback-row]');
      if (row) row.hidden = payback == null;
      if (payback != null) this.out.payback.textContent = `${payback} an${payback > 1 ? 's' : ''}`;
    }
  }
}
if (!customElements.get('clarte-simulator')) customElements.define('clarte-simulator', ClarteSimulator);
