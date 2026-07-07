/* ================================================================
   PHC STORAGE ADAPTER — Supabase Storage, private bucket.

   Workshop never calls Supabase Storage directly. It only calls
   this adapter's three methods. If you ever move media somewhere
   else (a different provider, a different bucket strategy), you
   rewrite this file only — workshop.js and phc-workshop.config.js
   never change.

   Depends on `sb` (the Supabase client already defined earlier in
   PHC's inline script) being in scope.
   ================================================================ */

const phcStorageAdapter = {
  bucket: 'phc-media',

  // file: a File object from an <input type="file">
  // ctx: { recordId } — the idea's id if editing, or null/undefined for a new idea
  async upload(file, ctx) {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = (ctx && ctx.recordId) ? ctx.recordId : 'new';
    const path = `${folder}/${Date.now().toString(36)}-${cleanName}`;
    const { error } = await sb.storage.from(phcStorageAdapter.bucket).upload(path, file);
    if (error) throw error;
    return { name: file.name, path };
  },

  // path: the storage path saved on the record (e.g. from upload() above)
  // returns a temporary signed URL, since the bucket is private
  async getUrl(path) {
    const { data, error } = await sb.storage.from(phcStorageAdapter.bucket).createSignedUrl(path, 3600);
    if (error) return null;
    return data.signedUrl;
  },

  async remove(path) {
    if (!path) return;
    await sb.storage.from(phcStorageAdapter.bucket).remove([path]);
  },
};
