/* ================================================================
   WORKSHOP v2 — a reusable, config-driven entry editor.

   Still knows nothing about critters, ideas, or notes. Field types:
   text, textarea, select, boolean, chips, tagselect, combo, image,
   audio, files, linklist.

   NEW in v2 (fully backward compatible with v1 configs):
   - config.storageAdapter: { upload(file, ctx), getUrl(path), remove(path) }
     Lets Workshop stay ignorant of *how* files are stored. Today it's
     Supabase Storage; swapping providers later only means writing a
     new adapter — Workshop itself never changes.
   - idStrategy: 'slug' | 'uuid' | 'db'
     'db' = let the database generate the id (insert, then read the
     generated id back) instead of the client generating one.
   - field type 'files': multi-file upload through storageAdapter,
     with async signed-URL previews (image or audio).
   - field type 'linklist': repeating { label, url } pairs.
   - field type 'combo': freeform text + <datalist> suggestions +
     a "Save" button that calls config.onAddOption(key, value) —
     the reusable version of a "type your own or pick one" input.

   Reuses your existing CSS classes: form-input, form-textarea,
   form-select, form-row, form-label, chip, list-item, list-item-del,
   list-add-row, star-toggle, image-preview, form-file, audio-player,
   modal-overlay, modal, modal-title, modal-close, btn-primary,
   btn-ghost, btn-small, topic-grid.
   ================================================================ */

function createWorkshop(config) {
  const {
    containerId   = 'workshopContainer',
    title         = 'Workshop',
    table,                          // Supabase table name, required
    supabase,                       // Supabase client, required
    idColumn      = 'id',
    idStrategy    = 'slug',         // 'slug' | 'uuid' | 'db'
    idSourceField = 'name',         // which field to derive a slug from (slug strategy only)
    fields        = [],
    existingIds   = () => [],       // fn returning array of ids already in use (slug collisions)
    storageAdapter = null,          // { upload(file, ctx), getUrl(path), remove(path) }
    onAddOption   = null,           // (fieldKey, value) => void — for 'combo' fields
    onSaved       = () => {},       // (record, isNew) => void
    onDeleted     = () => {},       // (id) => void
    onToast       = (msg) => console.log(msg),
  } = config;

  let state = {};
  let editingId = null;
  let renderToken = 0;   // bumped every render() — lets stale async work detect it's obsolete
  let saving = false;    // guards against double-click / double-submit

  // ---------- id generation (slug / uuid strategies only) ----------
  function slugify(str) {
    return String(str || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item';
  }

  function genId(sourceVal) {
    if (idStrategy === 'uuid') {
      return (crypto.randomUUID ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2));
    }
    const base = slugify(sourceVal);
    const taken = new Set(existingIds());
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  // ---------- container ----------
  function ensureContainer() {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      document.body.appendChild(el);
    }
    return el;
  }

  function defaultFor(field) {
    if (field.type === 'boolean') return false;
    if (field.type === 'chips' || field.type === 'tagselect' || field.type === 'files' || field.type === 'linklist') return [];
    return '';
  }

  // ---------- built-in toast (self-contained — no host CSS required) ----------
  let toastTimer;
  function ensureToastEl() {
    let t = document.getElementById(`${containerId}-toast`);
    if (!t) {
      t = document.createElement('div');
      t.id = `${containerId}-toast`;
      t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#222;color:#fff;font-weight:600;padding:10px 20px;border-radius:30px;font-size:13px;z-index:10000;opacity:0;transition:opacity 0.2s;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(t);
    }
    return t;
  }
  function notify(msg) {
    const t = ensureToastEl();
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
    onToast(msg); // still let the host app react too, if it wants to (e.g. its own status line)
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- open / close ----------
  function open(record) {
    editingId = record ? record[idColumn] : null;
    state = {};
    fields.forEach(f => {
      if (record && record[f.key] !== undefined && record[f.key] !== null) {
        const isArrayType = f.type === 'chips' || f.type === 'tagselect' || f.type === 'files' || f.type === 'linklist';
        state[f.key] = isArrayType ? [...(record[f.key] || [])] : record[f.key];
      } else {
        state[f.key] = defaultFor(f);
      }
    });
    render();
    const ov = document.getElementById(containerId + '-overlay');
    ov.classList.add('open');
    ov.style.display = 'flex';
  }

  function close() {
    const ov = document.getElementById(containerId + '-overlay');
    if (ov) {
      ov.classList.remove('open');
      ov.style.display = 'none';
    }
  }

  // ---------- field rendering ----------
  function fieldHTML(f) {
    const val = state[f.key];
    const id = `wk_${f.key}`;
    switch (f.type) {
      case 'text':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <input class="form-input" id="${id}" placeholder="${esc(f.placeholder || '')}" value="${esc(val)}"></div>`;

      case 'textarea':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <textarea class="form-textarea" id="${id}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea></div>`;

      case 'select': {
        const opts = (typeof f.options === 'function' ? f.options() : (f.options || []))
          .map(o => (typeof o === 'object' ? o : { value: o, label: o }));
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <select class="form-select" id="${id}">
            <option value="">Select…</option>
            ${opts.map(o => `<option value="${esc(o.value)}" ${o.value === val ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select></div>`;
      }

      case 'combo': {
        const opts = typeof f.options === 'function' ? f.options() : (f.options || []);
        const listId = `${id}_datalist`;
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <div class="list-add-row">
            <input class="form-input" id="${id}" list="${listId}" value="${esc(val)}" placeholder="${esc(f.placeholder || 'Add or choose…')}">
            <button type="button" class="btn-small" data-comboadd="${f.key}">Save</button>
          </div>
          <datalist id="${listId}">${opts.map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>`;
      }

      case 'boolean':
        return `<div class="form-row"><button type="button" class="star-toggle${val ? ' active' : ''}" id="${id}">${esc(f.label)}</button></div>`;

      case 'chips':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <div class="list-add-row">
            <input class="form-input" id="${id}_draft" placeholder="${esc(f.placeholder || 'Add item…')}">
            <button type="button" class="btn-small" data-chipadd="${f.key}">Add</button>
          </div>
          <div id="${id}_list"></div></div>`;

      case 'tagselect':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <div class="topic-grid" id="${id}_grid"></div>
          <div class="list-add-row">
            <input class="form-input" id="${id}_custom" placeholder="Add custom…">
            <button type="button" class="btn-small" data-tagcustom="${f.key}">Add</button>
          </div></div>`;

      case 'image':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <input type="file" class="form-file" id="${id}" accept="image/*">
          <img id="${id}_preview" class="image-preview" ${val ? `src="${val}" style="display:block"` : ''}></div>`;

      case 'audio':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <input type="file" class="form-file" id="${id}" accept="audio/*">
          <div id="${id}_preview">${val ? `<audio controls class="audio-player"><source src="${val}"></audio>` : ''}</div></div>`;

      case 'files':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <input type="file" class="form-file" id="${id}" accept="${esc(f.accept || '')}" multiple>
          <div id="${id}_status" style="font-size:12px;color:#888;margin-top:4px"></div>
          <div id="${id}_list" class="topic-grid" style="margin-top:6px"></div></div>`;

      case 'linklist':
        return `<div class="form-row"><label class="form-label">${esc(f.label)}</label>
          <div class="list-add-row">
            <input class="form-input" id="${id}_label" placeholder="Label">
            <input class="form-input" id="${id}_url" placeholder="https://…">
            <button type="button" class="btn-small" data-linkadd="${f.key}">Add</button>
          </div>
          <div id="${id}_list"></div></div>`;

      default:
        return '';
    }
  }

  function render() {
    renderToken++;
    const el = ensureContainer();
    el.innerHTML = `
      <div class="modal-overlay" id="${containerId}-overlay" style="position:fixed;inset:0;display:none;padding:20px;z-index:9999;">
        <div class="modal" style="max-width:620px;width:100%;max-height:88vh;overflow-y:auto;box-sizing:border-box;">
          <div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <span>${editingId ? '✏️ Edit — ' + esc(state[idSourceField]) : '✨ New ' + esc(title)}</span>
            <button type="button" class="modal-close" id="${containerId}-close" style="cursor:pointer;line-height:1;">×</button>
          </div>
          ${fields.map(fieldHTML).join('')}
          <button type="button" class="btn-primary" id="${containerId}-save" style="cursor:pointer;">Save</button>
          <button type="button" class="btn-ghost" id="${containerId}-cancel" style="cursor:pointer;">Cancel</button>
        </div>
      </div>`;
    wireEvents();
  }

  function wireEvents() {
    document.getElementById(`${containerId}-close`).onclick = close;
    document.getElementById(`${containerId}-cancel`).onclick = close;
    document.getElementById(`${containerId}-save`).onclick = save;

    fields.forEach(f => {
      const id = `wk_${f.key}`;

      if (f.type === 'boolean') {
        document.getElementById(id).onclick = () => {
          state[f.key] = !state[f.key];
          document.getElementById(id).classList.toggle('active', state[f.key]);
        };
      }

      if (f.type === 'combo') {
        document.getElementById(id).oninput = (e) => { state[f.key] = e.target.value; };
        const btn = document.querySelector(`[data-comboadd="${f.key}"]`);
        if (btn) btn.onclick = () => {
          const v = state[f.key];
          if (v && onAddOption) onAddOption(f.key, v);
        };
      }

      if (f.type === 'chips') {
        renderChipList(f);
        document.querySelector(`[data-chipadd="${f.key}"]`).onclick = () => {
          const input = document.getElementById(id + '_draft');
          const v = input.value.trim();
          if (!v) return;
          state[f.key].push(v);
          input.value = '';
          renderChipList(f);
        };
      }

      if (f.type === 'tagselect') {
        renderTagGrid(f);
        document.querySelector(`[data-tagcustom="${f.key}"]`).onclick = () => {
          const input = document.getElementById(id + '_custom');
          const v = input.value.trim();
          if (!v || state[f.key].includes(v)) { input.value = ''; return; }
          state[f.key].push(v);
          input.value = '';
          renderTagGrid(f);
        };
      }

      if (f.type === 'image' || f.type === 'audio') {
        document.getElementById(id).onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            state[f.key] = ev.target.result;
            const prev = document.getElementById(id + '_preview');
            if (f.type === 'image') {
              prev.src = ev.target.result;
              prev.style.display = 'block';
            } else {
              prev.innerHTML = `<audio controls class="audio-player"><source src="${ev.target.result}"></audio>`;
            }
          };
          reader.readAsDataURL(file);
        };
      }

      if (f.type === 'files') {
        renderFileList(f);
        document.getElementById(id).onchange = async (e) => {
          const token = renderToken;
          const files = Array.from(e.target.files || []);
          if (!files.length) return;
          const statusEl = document.getElementById(id + '_status');
          if (!storageAdapter) { notify('⚠️ No storage adapter configured'); return; }
          statusEl.textContent = 'Uploading…';
          for (const file of files) {
            try {
              const item = await storageAdapter.upload(file, { recordId: editingId });
              if (token !== renderToken) return; // a different record is open now — drop this upload
              state[f.key].push(item);
            } catch (err) {
              notify('⚠️ Upload failed: ' + err.message);
            }
          }
          if (token !== renderToken) return;
          statusEl.textContent = '';
          e.target.value = '';
          renderFileList(f);
        };
      }

      if (f.type === 'linklist') {
        renderLinkList(f);
        document.querySelector(`[data-linkadd="${f.key}"]`).onclick = () => {
          const label = document.getElementById(id + '_label').value.trim();
          const url = document.getElementById(id + '_url').value.trim();
          if (!url) return;
          state[f.key].push({ label: label || 'Link', url });
          document.getElementById(id + '_label').value = '';
          document.getElementById(id + '_url').value = '';
          renderLinkList(f);
        };
      }
    });
  }

  function renderChipList(f) {
    const list = document.getElementById(`wk_${f.key}_list`);
    list.innerHTML = state[f.key].map((item, i) =>
      `<div class="list-item"><span class="list-item-text">${esc(item)}</span>
       <button type="button" class="list-item-del" data-chipdel="${f.key}::${i}">×</button></div>`
    ).join('');
    list.querySelectorAll('[data-chipdel]').forEach(btn => {
      btn.onclick = () => {
        const [key, idx] = btn.dataset.chipdel.split('::');
        state[key].splice(Number(idx), 1);
        renderChipList(f);
      };
    });
  }

  function renderTagGrid(f) {
    const grid = document.getElementById(`wk_${f.key}_grid`);
    const preset = f.presetOptions || [];
    const all = [...new Set([...preset, ...state[f.key]])];
    grid.innerHTML = all.map(t =>
      `<button type="button" class="chip${state[f.key].includes(t) ? ' active' : ''}" data-tagtoggle="${f.key}::${esc(t)}">${esc(t)}</button>`
    ).join('');
    grid.querySelectorAll('[data-tagtoggle]').forEach(btn => {
      btn.onclick = () => {
        const idx = btn.dataset.tagtoggle.indexOf('::');
        const key = btn.dataset.tagtoggle.slice(0, idx);
        const val = btn.dataset.tagtoggle.slice(idx + 2);
        if (state[key].includes(val)) state[key] = state[key].filter(x => x !== val);
        else state[key].push(val);
        renderTagGrid(f);
      };
    });
  }

  function renderLinkList(f) {
    const list = document.getElementById(`wk_${f.key}_list`);
    list.innerHTML = state[f.key].map((item, i) =>
      `<div class="list-item"><span class="list-item-text">${esc(item.label)}: ${esc(item.url)}</span>
       <button type="button" class="list-item-del" data-linkdel="${f.key}::${i}">×</button></div>`
    ).join('');
    list.querySelectorAll('[data-linkdel]').forEach(btn => {
      btn.onclick = () => {
        const [key, idx] = btn.dataset.linkdel.split('::');
        state[key].splice(Number(idx), 1);
        renderLinkList(f);
      };
    });
  }

  function renderFileList(f) {
    const token = renderToken;
    const list = document.getElementById(`wk_${f.key}_list`);
    const items = state[f.key] || [];
    list.innerHTML = items.map((item, i) => `
      <div class="list-item">
        <span class="list-item-text" id="wk_${f.key}_${i}_preview">${esc(item.name)}${item.path ? ' (loading preview…)' : ''}</span>
        <button type="button" class="list-item-del" data-filedel="${f.key}::${i}">×</button>
      </div>`).join('');

    list.querySelectorAll('[data-filedel]').forEach(btn => {
      btn.onclick = async () => {
        const [key, idxStr] = btn.dataset.filedel.split('::');
        const idx = Number(idxStr);
        const item = state[key][idx];
        if (storageAdapter && item.path) {
          try { await storageAdapter.remove(item.path); } catch (e) { /* ignore */ }
        }
        state[key].splice(idx, 1);
        renderFileList(f);
      };
    });

    if (storageAdapter) {
      items.forEach(async (item, i) => {
        if (!item.path) return;
        try {
          const url = await storageAdapter.getUrl(item.path);
          if (token !== renderToken) return; // a different record's modal is open now — don't touch its DOM
          const el = document.getElementById(`wk_${f.key}_${i}_preview`);
          if (!el || !url) return;
          if (f.as === 'audio') {
            el.outerHTML = `<audio controls class="audio-player" id="wk_${f.key}_${i}_preview" src="${url}" style="height:30px"></audio>`;
          } else {
            el.outerHTML = `<img class="image-preview" id="wk_${f.key}_${i}_preview" src="${url}" style="display:inline-block;width:60px;height:60px;object-fit:cover;margin-right:6px">`;
          }
        } catch (e) { /* ignore individual preview failures */ }
      });
    }
  }

  function readFieldValues() {
    fields.forEach(f => {
      const id = `wk_${f.key}`;
      if (f.type === 'text' || f.type === 'textarea') {
        state[f.key] = document.getElementById(id).value.trim();
      }
      if (f.type === 'select') {
        state[f.key] = document.getElementById(id).value;
      }
      // combo is kept live via oninput; boolean/chips/tagselect/image/audio/files/linklist
      // are already kept live in `state` directly.
    });
  }

  // ---------- save / delete ----------
  async function save() {
    if (saving) return; // a click already in flight — ignore repeats
    saving = true;
    const saveBtn = document.getElementById(`${containerId}-save`);
    if (saveBtn) saveBtn.disabled = true;

    try {
      readFieldValues();

      for (const f of fields.filter(f => f.required)) {
        const v = state[f.key];
        if (!v || (Array.isArray(v) && !v.length)) {
          notify(`${f.label} is required`);
          return;
        }
      }

      const record = { ...state };

      if (idStrategy === 'db') {
        if (editingId) {
          record[idColumn] = editingId;
          const { data, error } = await supabase.from(table).update(record).eq(idColumn, editingId).select().single();
          if (error) { notify('⚠️ Save failed: ' + error.message); return; }
          close(); onSaved(data, false); notify('Saved ✓');
        } else {
          const { data, error } = await supabase.from(table).insert(record).select().single();
          if (error) { notify('⚠️ Save failed: ' + error.message); return; }
          editingId = data[idColumn]; // a repeat click now updates instead of inserting a duplicate
          close(); onSaved(data, true); notify('Added 🎉');
        }
        return;
      }

      // slug / uuid strategies — unchanged from v1
      record[idColumn] = editingId || genId(state[idSourceField]);
      const { error } = await supabase.from(table).upsert(record);
      if (error) { notify('⚠️ Save failed: ' + error.message); return; }
      const wasNew = !editingId;
      editingId = record[idColumn];
      close();
      onSaved(record, wasNew);
      notify(wasNew ? 'Added 🎉' : 'Saved ✓');
    } finally {
      saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function remove(id) {
    const { error } = await supabase.from(table).delete().eq(idColumn, id);
    if (error) { notify('⚠️ Delete failed: ' + error.message); return; }
    onDeleted(id);
    notify('Removed');
  }

  return { open, close, remove };
}

/* ================================================================
   FIELD DEF REFERENCE

   { key, label, type, required?, placeholder?, options?, presetOptions?, accept?, as? }

   key    — must match the Supabase column name exactly.
   type   — 'text' | 'textarea' | 'select' | 'combo' | 'boolean'
             | 'chips' | 'tagselect' | 'image' | 'audio' | 'files' | 'linklist'
   options       — 'select'/'combo': array of strings, OR array of
                   {value,label}, OR a function returning either —
                   evaluated fresh every time the Workshop opens.
   presetOptions — 'tagselect': suggested tags shown alongside whatever
                   the record already has.
   accept        — 'files': file input accept string, e.g. 'image/*'.
   as            — 'files': 'image' (default) or 'audio' — controls
                   how previews render.
   required      — blocks save until filled.

   config.storageAdapter — required if any field is type 'files':
     { upload(file, ctx) -> Promise<{name, path}>,
       getUrl(path)      -> Promise<url>,
       remove(path)      -> Promise<void> }

   config.onAddOption(fieldKey, value) — required if any field is
   type 'combo' and you want "Save" to persist the new option somewhere.
   ================================================================ */
