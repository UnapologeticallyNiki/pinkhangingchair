/* ================================================================
   PLANTER WORKSHOP — config for the shared Workshop engine.
   This is the ONLY file that knows what an "idea" is.
   workshop.js has no idea (pun intended).

   Depends on globals defined elsewhere:
   - `sb`               — Supabase client (in PHC's main script)
   - `phcStorageAdapter` — from phc-storage-adapter.js
   - `createWorkshop`    — from workshop.js
   - a small bridge into React state — see the three window.__phc*
     globals below, set up by two useEffect hooks added to the
     PinkHangingChair component. See integration notes.
   ================================================================ */

const phcWorkshopConfig = {
  containerId: 'phcWorkshopContainer',
  title: 'Idea',
  table: 'ideas',
  supabase: sb,
  idColumn: 'id',
  idStrategy: 'db',   // Supabase generates the id (gen_random_uuid()) — Workshop reads it back after insert
  storageAdapter: phcStorageAdapter,

  existingIds: () => (window.__phcIdeas || []).map(i => i.id),

  fields: [
    { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '✨' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Name this idea…' },
    { key: 'type', label: 'Type', type: 'combo', options: () => (window.__phcCustomLists?.type || []) },
    { key: 'kind', label: 'Kind (optional)', type: 'text' },
    { key: 'level', label: 'Level', type: 'combo', options: () => (window.__phcCustomLists?.level || []) },
    { key: 'status', label: 'Status', type: 'select', options: [
        { value: 'draft', label: 'Draft' },
        { value: 'in-progress', label: 'In Progress' },
        { value: 'complete', label: 'Complete' },
        { value: 'missing-something', label: 'Missing Something' },
      ] },
    { key: 'comfort', label: 'Comfort level', type: 'combo', options: () => (window.__phcCustomLists?.comfort || []) },
    { key: 'need', label: 'Need', type: 'combo', options: () => (window.__phcCustomLists?.need || []) },
    { key: 'favorite', label: '⭐ Mark as favorite', type: 'boolean' },

    { key: 'who', label: 'Who', type: 'text' },
    { key: 'what', label: 'What', type: 'text' },
    { key: 'where', label: 'Where', type: 'text' },
    { key: 'when', label: 'When', type: 'text' },
    { key: 'how', label: 'How', type: 'text' },
    { key: 'why', label: 'Why', type: 'text' },

    { key: 'feelings', label: 'Feelings', type: 'textarea' },
    { key: 'quotes', label: 'Quotes', type: 'textarea' },
    { key: 'wisdom', label: 'Wisdom / lessons', type: 'textarea' },
    { key: 'metaphorical', label: 'Metaphorical', type: 'textarea' },
    { key: 'solutions', label: 'Solutions', type: 'textarea' },

    { key: 'topics', label: 'Topics / themes', type: 'tagselect', presetOptions: [] },
    { key: 'relationships', label: 'Relationships', type: 'textarea' },
    { key: 'related', label: 'Related', type: 'textarea' },
    { key: 'edition', label: 'Edition', type: 'text' },

    { key: 'images', label: 'Images', type: 'files', as: 'image', accept: 'image/*' },
    { key: 'audio', label: 'Audio', type: 'files', as: 'audio', accept: 'audio/*' },
    { key: 'note_links', label: 'Note / recording links', type: 'linklist' },

    { key: 'references_text', label: 'References / sources', type: 'textarea' },
    { key: 'suggestions', label: 'Suggestions', type: 'textarea' },
    { key: 'planning_notes', label: 'Planning notes (private)', type: 'textarea', placeholder: 'Only visible to you when you choose to reveal it…' },
  ],

  // "Save" button on a combo field (Type/Level/Comfort/Need) — persists
  // the new option to the phc_lists table, same as the old ComboField did.
  onAddOption: async (field, val) => {
    const lists = window.__phcCustomLists || {};
    if ((lists[field] || []).includes(val)) return;
    const updated = { ...lists, [field]: [...(lists[field] || []), val] };
    window.__phcCustomLists = updated;
    const column = { type: 'type_options', level: 'level_options', comfort: 'comfort_options', need: 'need_options' }[field];
    if (column) await sb.from('phc_lists').update({ [column]: updated[field] }).eq('id', 1);
  },

  onSaved: (row, isNew) => {
    const mapped = rowToIdea(row);
    window.__phcSetIdeas((prev) => isNew ? [...prev, mapped] : prev.map(i => i.id === mapped.id ? mapped : i));
  },

  onDeleted: (id) => {
    window.__phcSetIdeas((prev) => prev.filter(i => i.id !== id));
  },

  onToast: (msg) => (window.__phcFlash ? window.__phcFlash(msg) : console.log(msg)),
};


const PhcWorkshop = createWorkshop(phcWorkshopConfig);
