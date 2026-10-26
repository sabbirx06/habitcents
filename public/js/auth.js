const passwordToggle = document.querySelector('.password-toggle');
const passwordInput = document.getElementById('password');

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener('click', () => {
    const showPassword = passwordInput.type === 'password';
    passwordInput.type = showPassword ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', String(showPassword));
    passwordToggle.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
  });
}
