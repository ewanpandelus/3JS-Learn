const MODAL_Z_INDEX = '40';
const PANEL_MIN_WIDTH_PX = '320px';
const PANEL_BACKGROUND = 'rgba(10, 13, 18, 0.88)';
const PANEL_BORDER = '1px solid rgba(255,255,255,0.15)';
const INPUT_BACKGROUND = 'rgba(255,255,255,0.08)';
const BUTTON_BACKGROUND = '#2d7ef7';
const BUTTON_TEXT_COLOR = '#ffffff';
const SECONDARY_BUTTON_BACKGROUND = 'rgba(255,255,255,0.14)';
const STATUS_ERROR_COLOR = '#ff9ca3';
const STATUS_SUCCESS_COLOR = '#9ef3c1';
const STATUS_INFO_COLOR = '#c7d8ff';
const MODAL_BACKDROP = 'rgba(4, 6, 10, 0.56)';

/**
 * Creates a Supabase sign-in modal (opened on demand, e.g. from Save) plus programmatic sign-out.
 * Inputs: `supabase` client instance and `onAuthStateChange(isSignedIn, session)` callback.
 * Outputs: `{ destroy, openAuthModal, signOut }`; side effects include DOM nodes and auth listeners.
 * Internal: modal stays hidden until `openAuthModal`; session changes notify the app and close the modal after sign-in.
 */
export function createAuthOverlay(supabase, onAuthStateChange) {
  const modalRoot = document.createElement('section');
  modalRoot.setAttribute('aria-modal', 'true');
  modalRoot.setAttribute('role', 'dialog');
  modalRoot.setAttribute('aria-labelledby', 'auth-modal-title');
  modalRoot.style.position = 'fixed';
  modalRoot.style.inset = '0';
  modalRoot.style.display = 'none';
  modalRoot.style.alignItems = 'center';
  modalRoot.style.justifyContent = 'center';
  modalRoot.style.background = MODAL_BACKDROP;
  modalRoot.style.backdropFilter = 'blur(4px)';
  modalRoot.style.zIndex = MODAL_Z_INDEX;

  const panel = document.createElement('div');
  panel.style.width = 'min(90vw, 420px)';
  panel.style.minWidth = PANEL_MIN_WIDTH_PX;
  panel.style.padding = '16px';
  panel.style.borderRadius = '12px';
  panel.style.background = PANEL_BACKGROUND;
  panel.style.border = PANEL_BORDER;
  panel.style.color = '#f5f8ff';
  panel.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';
  panel.style.boxSizing = 'border-box';
  panel.style.position = 'relative';

  panel.innerHTML = `
    <button type="button" data-auth-close-modal aria-label="Close sign-in" style="${getIconCloseButtonStyle()}">✕</button>
    <h2 id="auth-modal-title" style="margin:0 0 8px;font-size:18px;">Cloud landscapes</h2>
    <p style="margin:0 0 12px;opacity:0.82;line-height:1.35;">Sign in to save and load terrain presets from your account. You can use the editor without signing in.</p>
    <form data-auth-form style="display:grid;gap:10px;">
      <label style="display:grid;gap:6px;">
        <span style="font-size:13px;">Email</span>
        <input name="email" type="email" required autocomplete="email" style="${getInputStyle()}" />
      </label>
      <label style="display:grid;gap:6px;">
        <span style="font-size:13px;">Password</span>
        <input name="password" type="password" required minlength="6" autocomplete="current-password" style="${getInputStyle()}" />
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="submit" data-auth-signin style="${getPrimaryButtonStyle()}">Sign In</button>
        <button type="button" data-auth-signup style="${getSecondaryButtonStyle()}">Sign Up</button>
      </div>
    </form>
    <p data-auth-status style="margin:12px 0 0;font-size:13px;min-height:18px;opacity:0.95;"></p>
  `;

  modalRoot.appendChild(panel);
  document.body.appendChild(modalRoot);

  const form = panel.querySelector('[data-auth-form]');
  const signInButton = panel.querySelector('[data-auth-signin]');
  const signUpButton = panel.querySelector('[data-auth-signup]');
  const closeModalButton = panel.querySelector('[data-auth-close-modal]');
  const status = panel.querySelector('[data-auth-status]');
  let authSubscription = null;

  /**
   * Hides the sign-in modal without changing session state.
   * Inputs: none.
   * Outputs: sets modal display to none.
   * Internal: toggles flex container used for centering the dialog panel.
   */
  function closeAuthModal() {
    modalRoot.style.display = 'none';
  }

  /**
   * Shows the sign-in modal for email/password entry.
   * Inputs: none.
   * Outputs: displays modal; seeds status when the line is still empty.
   * Internal: uses flex centering on the full-viewport backdrop.
   */
  function openAuthModal() {
    modalRoot.style.display = 'flex';
    if (status.textContent.trim().length === 0) {
      setStatus('Sign in or create an account to use cloud saves.', 'info');
    }
  }

  /**
   * Displays auth operation feedback inside the modal.
   * Inputs: `message` string and `tone` variant (`info`, `success`, `error`).
   * Outputs: updates status text content and color.
   * Internal: applies consistent tone colors for each auth state transition.
   */
  function setStatus(message, tone = 'info') {
    status.textContent = message;
    if (tone === 'error') {
      status.style.color = STATUS_ERROR_COLOR;
      return;
    }

    if (tone === 'success') {
      status.style.color = STATUS_SUCCESS_COLOR;
      return;
    }

    status.style.color = STATUS_INFO_COLOR;
  }

  /**
   * Applies session-derived UI and notifies the host app.
   * Inputs: `session` object from Supabase, or `null`.
   * Outputs: closes modal when signed in; invokes `onAuthStateChange`.
   * Internal: does not auto-open the modal when signed out.
   */
  function renderSession(session) {
    const isSignedIn = Boolean(session?.user?.id);
    if (isSignedIn) {
      closeAuthModal();
    }

    onAuthStateChange(isSignedIn, session ?? null);
  }

  /**
   * Handles sign-in form submission with email/password credentials.
   * Inputs: submit event from the auth form.
   * Outputs: attempts sign-in and updates feedback text.
   * Internal: reads form fields and calls `supabase.auth.signInWithPassword`.
   */
  async function handleSignIn(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    setStatus('Signing in...', 'info');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(error.message, 'error');
      return;
    }
    setStatus('Signed in successfully.', 'success');
  }

  /**
   * Handles user registration for first-time account creation.
   * Inputs: click event from Sign Up button.
   * Outputs: starts sign-up request and reports any confirmation requirements/errors.
   * Internal: posts email/password to Supabase Auth and prints next-step guidance.
   */
  async function handleSignUp() {
    const formData = new FormData(form);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    setStatus('Creating account...', 'info');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setStatus(error.message, 'error');
      return;
    }

    const needsEmailConfirm = !data?.session;
    if (needsEmailConfirm) {
      setStatus('Account created. Check your email to confirm before signing in.', 'success');
      return;
    }

    setStatus('Account created and signed in.', 'success');
  }

  /**
   * Signs out the current Supabase session for this browser tab.
   * Inputs: none.
   * Outputs: resolves when `signOut` completes; surfaces errors via modal status if still visible.
   * Internal: delegates to `supabase.auth.signOut`.
   */
  async function signOut() {
    setStatus('Signing out...', 'info');
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus(error.message, 'error');
      return;
    }
    setStatus('Signed out.', 'success');
  }

  /**
   * Closes modal when user activates the backdrop (not the panel).
   * Inputs: mouse event from backdrop `mousedown`.
   * Outputs: may call `closeAuthModal` when target is the backdrop element.
   * Internal: ignores clicks that originate on the inner panel.
   */
  function handleBackdropMouseDown(event) {
    if (event.target === modalRoot) {
      closeAuthModal();
    }
  }

  form.addEventListener('submit', handleSignIn);
  signInButton.addEventListener('click', () => {
    form.requestSubmit();
  });
  signUpButton.addEventListener('click', handleSignUp);
  closeModalButton.addEventListener('click', closeAuthModal);
  modalRoot.addEventListener('mousedown', handleBackdropMouseDown);

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      setStatus(`Session check failed: ${error.message}`, 'error');
      renderSession(null);
      return;
    }
    renderSession(data.session);
  });

  const subscriptionResult = supabase.auth.onAuthStateChange((_event, session) => {
    renderSession(session);
  });
  authSubscription = subscriptionResult.data.subscription;

  /**
   * Cleans up auth modal DOM and listener resources.
   * Inputs: none.
   * Outputs: removes event listeners, unsubscribes auth listener, and detaches the modal root.
   * Internal: performs deterministic teardown for hot reload and future app lifecycle support.
   */
  function destroy() {
    form.removeEventListener('submit', handleSignIn);
    signUpButton.removeEventListener('click', handleSignUp);
    closeModalButton.removeEventListener('click', closeAuthModal);
    modalRoot.removeEventListener('mousedown', handleBackdropMouseDown);
    if (authSubscription) {
      authSubscription.unsubscribe();
    }
    modalRoot.remove();
  }

  return { destroy, openAuthModal, signOut };
}

/**
 * Builds inline styles for the modal close control.
 * Inputs: none.
 * Outputs: css text string for a small absolute-positioned dismiss button.
 * Internal: positions the control in the panel corner without overlapping the title flow awkwardly.
 */
function getIconCloseButtonStyle() {
  return [
    'position:absolute',
    'top:10px',
    'right:10px',
    'width:32px',
    'height:32px',
    'padding:0',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.2)',
    `background:${SECONDARY_BUTTON_BACKGROUND}`,
    'color:#ffffff',
    'font-size:16px',
    'line-height:1',
    'cursor:pointer'
  ].join(';');
}

/**
 * Builds shared inline styles for auth input controls.
 * Inputs: none.
 * Outputs: css text string for text/password/email inputs.
 * Internal: centralizes repeated style values for consistency.
 */
function getInputStyle() {
  return [
    'width:100%',
    'box-sizing:border-box',
    'padding:10px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.18)',
    `background:${INPUT_BACKGROUND}`,
    'color:#ffffff'
  ].join(';');
}

/**
 * Builds shared inline styles for primary action buttons.
 * Inputs: none.
 * Outputs: css text string for primary CTA buttons.
 * Internal: defines high-contrast visuals for form submit actions.
 */
function getPrimaryButtonStyle() {
  return [
    'padding:9px 12px',
    'border-radius:8px',
    'border:none',
    `background:${BUTTON_BACKGROUND}`,
    `color:${BUTTON_TEXT_COLOR}`,
    'font-weight:600',
    'cursor:pointer'
  ].join(';');
}

/**
 * Builds shared inline styles for secondary action buttons.
 * Inputs: none.
 * Outputs: css text string for neutral buttons.
 * Internal: uses translucent styling to keep hierarchy beneath primary action.
 */
function getSecondaryButtonStyle() {
  return [
    'padding:9px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.18)',
    `background:${SECONDARY_BUTTON_BACKGROUND}`,
    'color:#ffffff',
    'font-weight:600',
    'cursor:pointer'
  ].join(';');
}
