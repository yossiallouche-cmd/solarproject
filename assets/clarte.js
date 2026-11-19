/* ======================================================================
   CLARTÉ — scripts des sections sur mesure
   - <clarte-projection>   simulateur d'économies (accueil)
   - <clarte-pricebox>     bloc prix fourniture / pose / total (fiche produit)
   - <clarte-installation> délai de pose standard / express + demande expresse
   - <clarte-rdv>          créneau d'appel technique + date de pose (panier)
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

/* ---------- Apparition douce des blocs .cl-reveal ----------------------- */
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px' });
  const observeAll = () => document.querySelectorAll('.cl-reveal:not(.is-visible)').forEach((el) => io.observe(el));
  observeAll();
  document.addEventListener('shopify:section:load', observeAll);
}

/* ---------- Simulateur d'économies -------------------------------------- */
class ClarteProjection extends HTMLElement {
  connectedCallback() {
    this.rate = parseFloat(this.dataset.rate || '0.45');
    this.inflation = parseFloat(this.dataset.inflation || '0.04');
    this.price = parseFloat(this.dataset.price || '3300');
    this.years = parseInt(this.dataset.years || '20', 10);
    this.input = this.querySelector('[data-input="bill"]');
    this.out = {};
    this.querySelectorAll('[data-out]').forEach((el) => { this.out[el.dataset.out] = el; });
    this.input?.addEventListener('input', () => this.update());
    this.update();
  }

  update() {
    const bill = parseFloat(this.input?.value || '0');
    const yearOne = bill * 12 * this.rate;
    let total = 0; const series = [];
    for (let y = 0; y < this.years; y++) { const s = yearOne * Math.pow(1 + this.inflation, y); series.push(s); total += s; }
    let cum = 0, roi = null;
    for (let y = 0; y < series.length; y++) { cum += series[y]; if (cum >= this.price) { roi = y + 1 - (cum - this.price) / series[y]; break; } }

    if (this.out.bill) this.out.bill.textContent = `${fmtInt(bill)} €`;
    if (this.out.year) this.out.year.textContent = `${fmtInt(yearOne)} €`;
    if (this.out.total) this.out.total.textContent = `${fmtInt(total)} €`;
    if (this.out.roi) this.out.roi.textContent = roi ? `${roi < 1.5 ? '1 an' : fmtInt(Math.round(roi)) + ' ans'}` : `> ${this.years} ans`;
    if (this.out.bars) {
      const max = Math.max(...series, 1);
      this.out.bars.innerHTML = series.map((s) => `<span style="height:${Math.max(4, (s / max) * 100)}%"></span>`).join('');
    }
  }
}
if (!customElements.get('clarte-projection')) customElements.define('clarte-projection', ClarteProjection);

/* ---------- Bloc prix produit ------------------------------------------- */
class ClartePricebox extends HTMLElement {
  connectedCallback() {
    this.form = document.forms[this.getAttribute('form')];
    try { this.map = JSON.parse(this.querySelector('script[data-variants]')?.textContent || '{}'); } catch (e) { this.map = {}; }
    this.months = parseInt(this.dataset.months || '0', 10);
    this.deposit = parseFloat(this.dataset.deposit || '0');
    this.extra = 0; // supplément (pose express) en centimes
    this.out = {};
    this.querySelectorAll('[data-out]').forEach((el) => { this.out[el.dataset.out] = el; });

    this._onVariant = (e) => { if (e.detail?.variant?.id) this.render(e.detail.variant.id); };
    this.form?.addEventListener('variant:change', this._onVariant);
    this._onInstall = (e) => { this.extra = e.detail?.extraCents || 0; this.render(this.currentId); };
    document.addEventListener('clarte:installation:change', this._onInstall);

    this.currentId = this.form?.id?.value || this.dataset.variant;
    this.render(this.currentId);
  }

  disconnectedCallback() {
    this.form?.removeEventListener('variant:change', this._onVariant);
    document.removeEventListener('clarte:installation:change', this._onInstall);
  }

  render(variantId) {
    const v = this.map[variantId];
    if (!v) return;
    this.currentId = variantId;
    const f = v.f, p = v.p;
    const total = v.t + this.extra;

    if (this.out.fourniture) this.out.fourniture.textContent = fmtMoney(f);
    if (this.out.pose) this.out.pose.textContent = fmtMoney(p);
    if (this.out.extra) { this.out.extra.textContent = `+ ${fmtMoney(this.extra)}`; this.out.extra.closest('[data-extra-line]').hidden = this.extra === 0; }
    if (this.out.total) this.out.total.textContent = fmtMoney(total);
    if (this.out.monthly && this.months > 0) this.out.monthly.textContent = fmtMoney(Math.round(total / this.months));
    if (this.out.deposit && this.deposit > 0) this.out.deposit.textContent = fmtMoney(Math.round(total * this.deposit / 100));
    if (this.out.balance && this.deposit > 0) this.out.balance.textContent = fmtMoney(total - Math.round(total * this.deposit / 100));
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

    // Interception de l'ajout au panier (phase de capture, avant le script du thème)
    this._onSubmit = (event) => this.onSubmit(event);
    document.addEventListener('submit', this._onSubmit, true);

    this.update();
  }

  disconnectedCallback() { document.removeEventListener('submit', this._onSubmit, true); }

  get isExpress() { return this.radios.find((r) => r.checked)?.dataset.delay === 'express'; }

  update() {
    const express = this.isExpress;
    if (this.consentBox) { if (express) this.consentBox.setAttribute('data-visible', ''); else this.consentBox.removeAttribute('data-visible'); }
    if (!express) { this.error?.removeAttribute('data-visible'); if (this.consent) this.consent.checked = false; }
    const checked = this.radios.find((r) => r.checked);
    if (this.propertyDelay) this.propertyDelay.value = checked?.dataset.label || '';
    if (this.propertyConsent) {
      this.propertyConsent.value = express && this.consent?.checked ? (this.consent.dataset.label || 'Oui') : '';
      this.propertyConsent.disabled = !(express && this.consent?.checked);
    }
    document.dispatchEvent(new CustomEvent('clarte:installation:change', { detail: { express, extraCents: express ? this.expressPrice : 0 } }));
  }

  async onSubmit(event) {
    if (event.target !== this.form) return;
    if (this.form.dataset.clarteBypass === '1') { delete this.form.dataset.clarteBypass; return; }
    if (!this.isExpress) return;

    if (!this.consent?.checked) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.error?.setAttribute('data-visible', '');
      this.consent?.focus();
      return;
    }
    if (!this.expressVariant) return;

    // On ajoute d'abord le service « Pose express » au panier, puis on laisse le thème ajouter le produit.
    event.preventDefault(); event.stopImmediatePropagation();
    const buttons = Array.from(this.form.elements).filter((b) => b.type === 'submit');
    buttons.forEach((b) => b.setAttribute('aria-busy', 'true'));
    try {
      await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ items: [{ id: parseInt(this.expressVariant, 10), quantity: 1, properties: { 'Pour': this.dataset.productTitle || '' } }] })
      });
    } catch (e) { /* on continue quand même : le produit principal doit être ajouté */ }
    buttons.forEach((b) => b.removeAttribute('aria-busy'));
    this.form.dataset.clarteBypass = '1';
    this.form.requestSubmit();
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
    this.build();
    this.refresh(false);
  }

  static num(value) {
    const m = String(value).replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  build() {
    this.box.innerHTML = '';
    this.data.options.forEach((opt, i) => {
      const numeric = opt.values.length > 1 && opt.values.every((v) => !isNaN(ClarteConfigurator.num(v)));
      const wrap = document.createElement('div');
      wrap.className = 'cl-config__opt';
      if (numeric) {
        const values = [...opt.values].sort((a, b) => ClarteConfigurator.num(a) - ClarteConfigurator.num(b));
        const idx = Math.max(0, values.indexOf(this.selection[i]));
        wrap.innerHTML = `
          <div class="cl-range">
            <div class="cl-range__head"><label>${opt.name}</label><output>${values[idx]}</output></div>
            <input type="range" min="0" max="${values.length - 1}" step="1" value="${idx}" aria-label="${opt.name}">
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

  /* Coche l'option correspondante dans le sélecteur de variantes d'Impact (masqué) */
  syncTheme(v) {
    if (!this.form) return;
    v.options.forEach((value, i) => {
      const input = Array.from(this.form.ownerDocument.querySelectorAll(`input[data-option-position="${i + 1}"][form="${this.form.id}"]`))
        .find((el) => el.value === value);
      if (input && !input.checked) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }

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
    const pw = (W - gap * (cols + 1)) / cols, ph = (D - gap * (rows + 1)) / rows;
    let cells = '';
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = n < panels; n++;
      cells += `<rect x="${(x0 + gap + c * (pw + gap)).toFixed(1)}" y="${(y0 + gap + r * (ph + gap)).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="2" fill="${on ? 'rgb(var(--cl-ink))' : 'rgb(var(--cl-line))'}" />`;
    }
    let carsSvg = '';
    const carW = Math.min(W / cars - 14, 2.1 * scale), carH = Math.min(D - 30, 4.4 * scale);
    for (let i = 0; i < cars; i++) {
      const cx = x0 + (W / cars) * (i + 0.5) - carW / 2, cy = y0 + (D - carH) / 2;
      carsSvg += `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${carW.toFixed(1)}" height="${carH.toFixed(1)}" rx="${(carW / 4).toFixed(1)}" fill="rgb(var(--cl-accent))" opacity=".9"/>
        <rect x="${(cx + carW * 0.15).toFixed(1)}" y="${(cy + carH * 0.22).toFixed(1)}" width="${(carW * 0.7).toFixed(1)}" height="${(carH * 0.28).toFixed(1)}" rx="3" fill="rgb(var(--cl-ink))" opacity=".25"/>`;
    }
    this.svg.innerHTML = `
      <rect x="${(x0 - 6).toFixed(1)}" y="${(y0 - 6).toFixed(1)}" width="${(W + 12).toFixed(1)}" height="${(D + 12).toFixed(1)}" rx="8" fill="#fff" stroke="rgb(var(--cl-line))"/>
      <g opacity=".35">${carsSvg}</g>
      <g>${cells}</g>
      <text x="200" y="${(y0 - 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgb(var(--cl-muted))">${width.toLocaleString('fr-FR')} m</text>
      <text x="${(x0 - 14).toFixed(1)}" y="130" text-anchor="middle" font-size="11" fill="rgb(var(--cl-muted))" transform="rotate(-90 ${(x0 - 14).toFixed(1)} 130)">${depth.toLocaleString('fr-FR')} m</text>`;
  }
}
if (!customElements.get('clarte-configurator')) customElements.define('clarte-configurator', ClarteConfigurator);
