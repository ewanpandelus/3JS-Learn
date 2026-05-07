const LANDSCAPES_TABLE = 'landscapes';
const MAX_LIST_LIMIT = 50;

/**
 * Creates a small data-access wrapper for Supabase landscape records.
 * Inputs: `supabase` client from `@supabase/supabase-js`.
 * Outputs: CRUD methods (`list`, `save`, `rename`, `remove`) for authenticated user landscapes.
 * Internal: all calls target the `landscapes` table with ordered queries and explicit error propagation.
 */
export function createLandscapeStore(supabase) {
  /**
   * Lists the most recent landscapes for the current authenticated user.
   * Inputs: none.
   * Outputs: array of landscape rows sorted newest-first; throws on query error.
   * Internal: selects lightweight columns and caps result size to keep UI responsive.
   */
  async function list() {
    const { data, error } = await supabase
      .from(LANDSCAPES_TABLE)
      .select('id, name, config_json, is_public, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(MAX_LIST_LIMIT);

    if (error) {
      throw new Error(error.message);
    }

    return data ?? [];
  }

  /**
   * Saves a new landscape configuration row for the current user.
   * Inputs: `name` as non-empty string and `config` as serializable object.
   * Outputs: inserted landscape row; throws on validation or API error.
   * Internal: trims name, performs basic object guard, and inserts into Supabase with `select().single()`.
   */
  async function save(name, config) {
    const trimmedName = String(name ?? '').trim();
    if (trimmedName.length === 0) {
      throw new Error('Landscape name is required.');
    }

    if (!config || typeof config !== 'object') {
      throw new Error('Landscape config must be an object.');
    }

    const { data, error } = await supabase
      .from(LANDSCAPES_TABLE)
      .insert({
        name: trimmedName,
        config_json: config
      })
      .select('id, name, config_json, is_public, created_at, updated_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Renames an existing landscape row owned by the current user.
   * Inputs: `id` row UUID and `nextName` non-empty string.
   * Outputs: updated row metadata; throws on validation or API error.
   * Internal: updates by row id and relies on RLS to enforce ownership.
   */
  async function rename(id, nextName) {
    const trimmedName = String(nextName ?? '').trim();
    if (trimmedName.length === 0) {
      throw new Error('New name is required.');
    }

    const { data, error } = await supabase
      .from(LANDSCAPES_TABLE)
      .update({ name: trimmedName })
      .eq('id', id)
      .select('id, name, updated_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Deletes one landscape row owned by the current user.
   * Inputs: `id` row UUID.
   * Outputs: none; throws when delete fails.
   * Internal: executes filtered delete and checks the returned error object.
   */
  async function remove(id) {
    const { error } = await supabase.from(LANDSCAPES_TABLE).delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    list,
    save,
    rename,
    remove
  };
}
