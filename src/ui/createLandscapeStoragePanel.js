const PANEL_Z_INDEX = '22';
const PANEL_WIDTH_PX = '300px';
const PANEL_BACKGROUND = 'rgba(15, 21, 18, 0.8)';
const PANEL_BORDER = '1px solid rgba(255,255,255,0.14)';
const PANEL_TEXT_COLOR = '#f2f8ef';
const PANEL_FONT = 'Inter, Segoe UI, Arial, sans-serif';
const INPUT_BACKGROUND = 'rgba(255,255,255,0.08)';
const INPUT_BORDER = '1px solid rgba(255,255,255,0.2)';
const PRIMARY_BUTTON_BG = '#2d7ef7';
const PRIMARY_BUTTON_TEXT = '#ffffff';
const SECONDARY_BUTTON_BG = 'rgba(255,255,255,0.14)';
const MUTED_TEXT = '#c7d8d4';
const STATUS_SUCCESS = '#9ef3c1';
const STATUS_ERROR = '#ff9ca3';
const STATUS_INFO = '#c7d8ff';
const DATE_FORMAT_OPTIONS = { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' };

/**
 * Creates a storage panel for save/list/load/rename/delete landscape operations.
 * Inputs: `store` CRUD adapter, serialize/apply callbacks, optional `requestSignIn` (opens auth UI), optional `signOut` (ends session).
 * Outputs: mounted panel with `element`, `refresh()`, `setSignedIn()`, and `destroy()` methods.
 * Internal: save while signed out triggers `requestSignIn`; list actions including Load render only after sign-in.
 */
export function createLandscapeStoragePanel({ store, getCurrentConfig, applyConfig, requestSignIn, signOut }) {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Landscape storage');
  panel.style.position = 'fixed';
  panel.style.top = '12px';
  panel.style.right = '12px';
  panel.style.zIndex = PANEL_Z_INDEX;
  panel.style.width = PANEL_WIDTH_PX;
  panel.style.borderRadius = '10px';
  panel.style.padding = '12px';
  panel.style.background = PANEL_BACKGROUND;
  panel.style.border = PANEL_BORDER;
  panel.style.color = PANEL_TEXT_COLOR;
  panel.style.fontFamily = PANEL_FONT;
  panel.style.fontSize = '13px';
  panel.style.boxSizing = 'border-box';

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
      <h2 style="margin:0;font-size:14px;font-weight:600;line-height:1.3;">Landscapes</h2>
      <button data-landscape-signout type="button" style="${getSecondaryButtonStyle()};display:none;padding:6px 8px;font-size:11px;">Sign out</button>
    </div>
    <p style="margin:0 0 10px;opacity:0.82;line-height:1.35;">Save terrain presets to Supabase and reload anytime.</p>
    <label style="display:block;margin-bottom:8px;">
      <span style="display:block;margin-bottom:4px;">Name</span>
      <input data-landscape-name type="text" placeholder="My Island" style="${getInputStyle()}" />
    </label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button data-landscape-save type="button" style="${getPrimaryButtonStyle()}">Save Current</button>
      <button data-landscape-refresh type="button" style="${getSecondaryButtonStyle()}">Refresh</button>
    </div>
    <p data-landscape-status style="margin:10px 0 8px;min-height:18px;color:${MUTED_TEXT};"></p>
    <div data-landscape-list style="display:grid;gap:8px;max-height:280px;overflow:auto;"></div>
  `;

  document.body.appendChild(panel);

  const nameInput = panel.querySelector('[data-landscape-name]');
  const saveButton = panel.querySelector('[data-landscape-save]');
  const refreshButton = panel.querySelector('[data-landscape-refresh]');
  const signOutButton = panel.querySelector('[data-landscape-signout]');
  const status = panel.querySelector('[data-landscape-status]');
  const listRoot = panel.querySelector('[data-landscape-list]');
  let isSignedIn = false;

  /**
   * Updates the panel status text with an info/success/error tone.
   * Inputs: `message` string and optional `tone` enum (`info`, `success`, `error`).
   * Outputs: mutates status text and color.
   * Internal: centralizes user feedback styling for all storage operations.
   */
  function setStatus(message, tone = 'info') {
    status.textContent = message;
    if (tone === 'error') {
      status.style.color = STATUS_ERROR;
      return;
    }
    if (tone === 'success') {
      status.style.color = STATUS_SUCCESS;
      return;
    }
    status.style.color = STATUS_INFO;
  }

  /**
   * Renders a short hint when the user is not signed in (no cloud list, no Load buttons).
   * Inputs: none.
   * Outputs: replaces list container children with a single guidance paragraph.
   * Internal: avoids calling `store.list` until a session exists.
   */
  function renderSignedOutPlaceholder() {
    listRoot.innerHTML = '';
    const hint = document.createElement('p');
    hint.style.margin = '0';
    hint.style.opacity = '0.85';
    hint.style.lineHeight = '1.35';
    hint.textContent = 'Sign in to list your cloud saves. Load appears on each row after you are signed in.';
    listRoot.appendChild(hint);
  }

  /**
   * Renders landscape entries in the list area with Load/Rename/Delete actions for each row.
   * Inputs: `rows` array returned by `store.list()` (only used when signed in).
   * Outputs: rebuilds list DOM with action buttons including Load.
   * Internal: clears previous nodes and creates compact action cards on each refresh.
   */
  function renderList(rows) {
    listRoot.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.style.margin = '0';
      empty.style.opacity = '0.85';
      empty.textContent = 'No saved landscapes yet.';
      listRoot.appendChild(empty);
      return;
    }

    for (const row of rows) {
      const card = document.createElement('article');
      card.style.padding = '8px';
      card.style.borderRadius = '8px';
      card.style.background = 'rgba(255,255,255,0.06)';
      card.style.border = '1px solid rgba(255,255,255,0.14)';
      card.style.display = 'grid';
      card.style.gap = '6px';

      const updatedLabel = formatUpdatedAt(row.updated_at);
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <strong style="font-size:13px;overflow-wrap:anywhere;">${escapeHtml(row.name ?? 'Untitled')}</strong>
          <span style="font-size:11px;color:${MUTED_TEXT};">${updatedLabel}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" data-action="load" data-id="${row.id}" style="${getSecondaryButtonStyle()}">Load</button>
          <button type="button" data-action="rename" data-id="${row.id}" data-name="${escapeHtmlAttribute(row.name ?? '')}" style="${getSecondaryButtonStyle()}">Rename</button>
          <button type="button" data-action="delete" data-id="${row.id}" style="${getSecondaryButtonStyle()}">Delete</button>
        </div>
      `;
      listRoot.appendChild(card);
    }
  }

  /**
   * Fetches the latest list from Supabase and repaints the UI.
   * Inputs: none.
   * Outputs: updates list cards and status text; may throw on store failures.
   * Internal: calls `store.list` and forwards errors through shared status formatter.
   */
  async function refresh() {
    if (!isSignedIn) {
      return;
    }

    try {
      const rows = await store.list();
      renderList(rows);
      setStatus(`Loaded ${rows.length} saved landscape${rows.length === 1 ? '' : 's'}.`, 'info');
    } catch (error) {
      setStatus(`Refresh failed: ${error.message}`, 'error');
    }
  }

  /**
   * Saves the current in-memory terrain config as a new landscape row.
   * Inputs: none.
   * Outputs: inserts new row, clears name input, and refreshes list.
   * Internal: serializes active config through `getCurrentConfig` callback before persisting.
   */
  async function handleSaveClick() {
    if (!isSignedIn) {
      const name = nameInput.value.trim();
      if (!name) {
        setStatus('Enter a name before saving.', 'error');
        return;
      }
      if (typeof requestSignIn === 'function') {
        requestSignIn();
        setStatus('Sign in in the dialog to save your landscape.', 'info');
        return;
      }
      setStatus('Cloud sign-in is not available.', 'error');
      return;
    }

    const name = nameInput.value.trim();
    if (!name) {
      setStatus('Enter a name before saving.', 'error');
      return;
    }

    setStatus('Saving landscape...', 'info');
    try {
      const config = getCurrentConfig();
      await store.save(name, config);
      nameInput.value = '';
      setStatus('Landscape saved.', 'success');
      await refresh();
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, 'error');
    }
  }

  /**
   * Handles click actions for load, rename, and delete list controls.
   * Inputs: click event from the list root container.
   * Outputs: dispatches corresponding store/apply operations and refreshes as needed.
   * Internal: uses data attributes for action routing with one delegated listener.
   */
  async function handleListClick(event) {
    if (!isSignedIn || !(event.target instanceof HTMLButtonElement)) {
      return;
    }

    const action = event.target.dataset.action;
    const id = event.target.dataset.id;
    if (!action || !id) {
      return;
    }

    if (action === 'load') {
      try {
        const rows = await store.list();
        const selected = rows.find((row) => row.id === id);
        if (!selected) {
          setStatus('Landscape no longer exists. Refreshing list.', 'error');
          await refresh();
          return;
        }
        applyConfig(selected.config_json);
        setStatus(`Loaded "${selected.name}".`, 'success');
      } catch (error) {
        setStatus(`Load failed: ${error.message}`, 'error');
      }
      return;
    }

    if (action === 'rename') {
      const currentName = event.target.dataset.name ?? '';
      const nextName = window.prompt('Rename landscape', currentName);
      if (!nextName || !nextName.trim()) {
        return;
      }
      try {
        await store.rename(id, nextName.trim());
        setStatus('Landscape renamed.', 'success');
        await refresh();
      } catch (error) {
        setStatus(`Rename failed: ${error.message}`, 'error');
      }
      return;
    }

    if (action === 'delete') {
      const shouldDelete = window.confirm('Delete this landscape permanently?');
      if (!shouldDelete) {
        return;
      }
      try {
        await store.remove(id);
        setStatus('Landscape deleted.', 'success');
        await refresh();
      } catch (error) {
        setStatus(`Delete failed: ${error.message}`, 'error');
      }
    }
  }

  /**
   * Syncs panel controls and list visibility with Supabase session state.
   * Inputs: `nextSignedIn` boolean from auth.
   * Outputs: toggles refresh/sign-out, shows placeholder or awaits `refresh()` from the host when signed in.
   * Internal: keeps Save enabled while signed out so it can trigger the sign-in modal.
   */
  function setSignedIn(nextSignedIn) {
    isSignedIn = nextSignedIn;
    nameInput.disabled = false;
    saveButton.disabled = false;
    refreshButton.disabled = !nextSignedIn;
    signOutButton.style.display = nextSignedIn ? 'inline-block' : 'none';
    listRoot.style.pointerEvents = nextSignedIn ? 'auto' : 'none';
    panel.style.opacity = '1';
    if (!nextSignedIn) {
      renderSignedOutPlaceholder();
      setStatus('Choose Save Current to sign in. Load appears on each landscape after you sign in.', 'info');
      return;
    }
    setStatus('Storage ready.', 'info');
  }

  /**
   * Runs cloud sign-out from the landscapes header control.
   * Inputs: click event from Sign out.
   * Outputs: awaits optional `signOut` hook; re-enables the button when finished.
   * Internal: delegates to auth layer supplied by the app entry module.
   */
  async function handleSignOutClick() {
    if (typeof signOut !== 'function') {
      return;
    }
    signOutButton.disabled = true;
    try {
      await signOut();
    } finally {
      signOutButton.disabled = false;
    }
  }

  saveButton.addEventListener('click', handleSaveClick);
  refreshButton.addEventListener('click', refresh);
  listRoot.addEventListener('click', handleListClick);
  signOutButton.addEventListener('click', handleSignOutClick);

  setSignedIn(false);

  /**
   * Cleans up panel listeners and removes the mounted storage UI.
   * Inputs: none.
   * Outputs: detaches event handlers and removes panel from document.
   * Internal: provides explicit lifecycle teardown for future modular app integration.
   */
  function destroy() {
    saveButton.removeEventListener('click', handleSaveClick);
    refreshButton.removeEventListener('click', refresh);
    listRoot.removeEventListener('click', handleListClick);
    signOutButton.removeEventListener('click', handleSignOutClick);
    panel.remove();
  }

  return {
    element: panel,
    refresh,
    setSignedIn,
    destroy
  };
}

/**
 * Builds shared inline styles for text inputs used in this panel.
 * Inputs: none.
 * Outputs: css text string.
 * Internal: consolidates repeated style values for consistency.
 */
function getInputStyle() {
  return [
    'width:100%',
    'box-sizing:border-box',
    'padding:8px',
    'border-radius:8px',
    INPUT_BORDER,
    `background:${INPUT_BACKGROUND}`,
    'color:#ffffff'
  ].join(';');
}

/**
 * Builds shared inline styles for primary action buttons.
 * Inputs: none.
 * Outputs: css text string.
 * Internal: defines emphasized action visual treatment.
 */
function getPrimaryButtonStyle() {
  return [
    'padding:8px 10px',
    'border:none',
    'border-radius:8px',
    `background:${PRIMARY_BUTTON_BG}`,
    `color:${PRIMARY_BUTTON_TEXT}`,
    'font-weight:600',
    'cursor:pointer'
  ].join(';');
}

/**
 * Builds shared inline styles for secondary action buttons.
 * Inputs: none.
 * Outputs: css text string.
 * Internal: provides neutral button appearance for non-primary actions.
 */
function getSecondaryButtonStyle() {
  return [
    'padding:8px 10px',
    'border:1px solid rgba(255,255,255,0.17)',
    'border-radius:8px',
    `background:${SECONDARY_BUTTON_BG}`,
    'color:#ffffff',
    'cursor:pointer',
    'font-size:12px'
  ].join(';');
}

/**
 * Formats a timestamp into a short local label for landscape cards.
 * Inputs: `value` ISO date string.
 * Outputs: display string suitable for compact metadata labels.
 * Internal: falls back to "unknown" when date parsing fails.
 */
function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleString(undefined, DATE_FORMAT_OPTIONS);
}

/**
 * Escapes text for safe HTML element inner content.
 * Inputs: arbitrary string-like value.
 * Outputs: escaped string replacing reserved HTML characters.
 * Internal: applies simple character-map replacement for `<`, `>`, `&`, quotes.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Escapes text for safe HTML attribute embedding.
 * Inputs: arbitrary string-like value.
 * Outputs: escaped attribute-safe string.
 * Internal: delegates to `escapeHtml` for consistent protection.
 */
function escapeHtmlAttribute(value) {
  return escapeHtml(value);
}
