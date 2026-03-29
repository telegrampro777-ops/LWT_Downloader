const $ = id => document.getElementById(id);

let isRegister = false;

$('toggle-auth').addEventListener('click', (e) => {
  e.preventDefault();
  isRegister = !isRegister;
  
  $('name-group').style.display = isRegister ? 'block' : 'none';
  $('submit-btn').textContent = isRegister ? 'Register' : 'Sign In';
  $('toggle-msg').textContent = isRegister ? 'Already have an account?' : "Don't have an account?";
  $('toggle-auth').textContent = isRegister ? 'Sign In' : 'Register';
  $('error-msg').classList.add('hidden');
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = $('email').value;
  const password = $('password').value;
  const name = $('reg-name').value;
  const errorEl = $('error-msg');
  const btn = $('submit-btn');

  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.style.opacity = '0.7';

  try {
    const endpoint = isRegister ? '/auth/register' : '/auth/login';
    const body = isRegister ? { email, password, name } : { email, password };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (res.ok) {
      // Success! Go to main app
      window.location.href = '/';
    } else {
      errorEl.textContent = data.error || 'Authentication failed.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = 'Server error. Please try again.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
});

// Check for errors in URL (from Google OAuth failure)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('error')) {
  const errorEl = $('error-msg');
  errorEl.textContent = urlParams.get('error');
  errorEl.classList.remove('hidden');
}
