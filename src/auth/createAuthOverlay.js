const UI_Z_INDEX = '40';
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

/**
 * Creates an auth overlay that manages sign in/up and session state.
 * Inputs: `supabase` client instance and `onAuthStateChange(isSignedIn, session)` callback.
 * Outputs: mounted UI plus `destroy()` cleanup method; side effects include DOM nodes and auth listeners.
 * Internal: subscribes to Supabase auth events, renders either auth form or signed-in actions, and reports state changes upstream.
 */
export function createAuthOverlay(supabase, onAuthStateChange) {
  const root = document.createElement('section');
  root.setAttribute('aria-live', 'polite');
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.display = 'none';
  root.style.alignItems = 'center';
  root.style.justifyContent = 'center';
  root.style.background = 'rgba(4, 6, 10, 0.56)';
  root.style.backdropFilter = 'blur(4px)';
  root.style.zIndex = UI_Z_INDEX;

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

  panel.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:18px;">Landscape Auth</h2>
    <p style="margin:0 0 12px;opacity:0.82;line-height:1.35;">Sign in to use the terrain editor and save future landscapes.</p>
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
    <div data-auth-user style="display:none;gap:10px;align-items:center;">
      <span data-auth-email style="font-size:13px;opacity:0.9;"></span>
      <button type="button" data-auth-signout style="${getSecondaryButtonStyle()}">Sign Out</button>
    </div>
    <p data-auth-status style="margin:12px 0 0;font-size:13px;min-height:18px;opacity:0.95;"></p>
  `;

  root.appendChild(panel);
  document.body.appendChild(root);

  const form = panel.querySelector('[data-auth-form]');
  const signInButton = panel.querySelector('[data-auth-signin]');
  const signUpButton = panel.querySelector('[data-auth-signup]');
  const userRow = panel.querySelector('[data-auth-user]');
  const userEmail = panel.querySelector('[data-auth-email]');
  const signOutButton = panel.querySelector('[data-auth-signout]');
  const status = panel.querySelector('[data-auth-status]');
  let authSubscription = null;

  /**
   * Displays auth operation feedback to the user.
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
   * Toggles between signed-in and signed-out visual states.
   * Inputs: `session` object from Supabase, or `null`.
   * Outputs: updates form visibility, overlay visibility, and user identity row.
   * Internal: keeps editor locked behind overlay until an authenticated session exists.
   */
  function renderSession(session) {
    const isSignedIn = Boolean(session?.user?.id);
    root.style.display = isSignedIn ? 'none' : 'flex';
    form.style.display = isSignedIn ? 'none' : 'grid';
    userRow.style.display = isSignedIn ? 'flex' : 'none';
    userEmail.textContent = isSignedIn ? `Signed in as ${session.user.email ?? 'user'}` : '';

    if (!isSignedIn && status.textContent.length === 0) {
      setStatus('Sign in or create an account to continue.', 'info');
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
   * Handles explicit sign-out for the active authenticated user.
   * Inputs: click event from Sign Out button.
   * Outputs: clears server session and updates status feedback.
   * Internal: calls Supabase signOut and surfaces any returned error message.
   */
  async function handleSignOut() {
    setStatus('Signing out...', 'info');
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus(error.message, 'error');
      return;
    }
    setStatus('Signed out.', 'success');
  }

  form.addEventListener('submit', handleSignIn);
  signInButton.addEventListener('click', () => {
    form.requestSubmit();
  });
  signUpButton.addEventListener('click', handleSignUp);
  signOutButton.addEventListener('click', handleSignOut);

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
   * Cleans up auth overlay DOM and listener resources.
   * Inputs: none.
   * Outputs: removes event listeners, unsubscribes auth listener, and detaches overlay element.
   * Internal: performs deterministic teardown for hot reload and future app lifecycle support.
   */
  function destroy() {
    form.removeEventListener('submit', handleSignIn);
    signUpButton.removeEventListener('click', handleSignUp);
    signOutButton.removeEventListener('click', handleSignOut);
    if (authSubscription) {
      authSubscription.unsubscribe();
    }
    root.remove();
  }

  return { destroy };
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
