const API = ['5500', '5501'].includes(window.location.port)
  ? `${window.location.protocol}//${window.location.hostname}:5000/api`
  : `${window.location.origin}/api`;
const EDUCATION_EMAIL_PATTERN = /^[^@\s]+@iilm\.edu$/i;
let countdownInterval = null;
let resendInterval = null;
let currentUser = null;
let csrfToken = null;
let currentCourses = [];

// ===== UTILS =====
const $ = (id) => document.getElementById(id);
const showLoading = () => {
  const o = $('loadingOverlay');
  o.classList.remove('hidden');
  o.dataset.shownAt = Date.now();
};
const hideLoading = () => $('loadingOverlay').classList.add('hidden');
window.addEventListener('error', () => {
  try {
    hideLoading();
  } catch {}
});
window.addEventListener('unhandledrejection', () => {
  try {
    hideLoading();
  } catch {}
});
setInterval(() => {
  const o = $('loadingOverlay');
  if (o && !o.classList.contains('hidden')) {
    const t = Number(o.dataset.shownAt || 0);
    if (!t) o.dataset.shownAt = Date.now();
    else if (Date.now() - t > 8000) {
      o.classList.add('hidden');
      delete o.dataset.shownAt;
    }
  } else if (o) delete o.dataset.shownAt;
}, 1000);

function showToast(msg, type = 'info', duration = 4000) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  form.querySelectorAll('.error').forEach((f) => f.classList.remove('error'));
}

function showFieldError(fieldId, message) {
  const field = $(fieldId);
  if (!field) return;
  field.classList.add('error');
  field.setAttribute('aria-invalid', 'true');
  const error = document.createElement('small');
  error.className = 'field-error';
  error.textContent = message;
  const container = field.closest('.form-group');
  if (container) container.appendChild(error);
  else field.insertAdjacentElement('afterend', error);
  field.focus();
}

function showValidationError(form, fieldId, message) {
  clearFieldErrors(form);
  showFieldError(fieldId, message);
}

document.querySelectorAll('.auth-form input, .auth-form select').forEach((field) => {
  field.addEventListener('input', () => {
    field.classList.remove('error');
    field.removeAttribute('aria-invalid');
    field.closest('.form-group')?.querySelector('.field-error')?.remove();
  });
});

function requestError(data) {
  if (Array.isArray(data.errors) && data.errors.length) {
    return data.errors.map((e) => (typeof e === 'string' ? e : `${e.field}: ${e.message}`)).join(' ');
  }
  return data.message || 'The request could not be completed.';
}

// ===== CONNECTION STATUS =====
function setConnectionStatus(online) {
  let bar = $('connectionBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'connectionBar';
    document.body.prepend(bar);
  }
  if (online) {
    bar.className = 'connection-bar online';
    bar.textContent = 'Back online';
    setTimeout(() => bar.classList.add('hidden'), 2500);
  } else {
    bar.className = 'connection-bar offline';
    bar.textContent = 'You are offline — some features may not work';
    bar.classList.remove('hidden');
  }
}
window.addEventListener('online', () => setConnectionStatus(true));
window.addEventListener('offline', () => setConnectionStatus(false));

// ===== DARK MODE =====
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = $('darkModeToggle');
  if (btn) btn.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}
function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
  applyTheme(!isDark);
}
applyTheme(localStorage.getItem('theme') === 'dark');

// ===== CSRF =====
async function loadCsrfToken() {
  try {
    const response = await fetch(`${API}/auth/csrf`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Security setup failed (${response.status}).`);
    const data = await response.json();
    csrfToken = data.csrfToken;
  } catch (error) {
    throw new Error(`Cannot reach the backend at ${API}. ${error.message}`);
  }
}

async function apiFetch(endpoint, options = {}) {
  if (!csrfToken) await loadCsrfToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())
      ? { 'X-CSRF-Token': csrfToken }
      : {}),
    ...options.headers,
  };
  const res = await fetch(`${API}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  return res.json().catch(() => ({ success: false, message: 'Unexpected server response.' }));
}

// ===== SCREEN MANAGEMENT =====
function showScreen(screenId) {
  document.querySelectorAll('.auth-card').forEach((c) => c.classList.remove('active'));
  const screen = $(screenId);
  if (screen) screen.classList.add('active');
  if (screenId === 'loginScreen' || screenId === 'otpScreen') {
    resetOTPState();
    if (screenId === 'otpScreen') requestAnimationFrame(() => clearOTPBoxes());
  }
}

// ===== PASSWORD TOGGLE =====
function togglePassword(inputId) {
  const input = $(inputId);
  const btn = input.nextElementSibling;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
  } else {
    input.type = 'password';
    btn.innerHTML = '<i class="fas fa-eye"></i>';
  }
}

// ===== PASSWORD STRENGTH =====
$('regPassword')?.addEventListener('input', function () {
  const val = this.value;
  const bar = $('passwordStrength');
  if (!bar) return;
  if (!val) {
    bar.className = 'password-strength';
    return;
  }
  const strong = val.length >= 12 && /[A-Z]/.test(val) && /[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val);
  const medium = val.length >= 6 && (/[A-Z]/.test(val) || /[0-9]/.test(val));
  bar.className = `password-strength ${strong ? 'strength-strong' : medium ? 'strength-medium' : 'strength-weak'}`;
});

// ===== REGISTER (disabled — admin only) =====
$('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showToast('Student accounts are created by the administrator.', 'warning');
});

// ===== PASSWORD RESET =====
function validPassword(password) {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

$('forgotPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(e.currentTarget);
  const email = $('forgotEmail').value.trim();
  if (!email) return showValidationError(e.currentTarget, 'forgotEmail', 'Email is required.');
  if (!EDUCATION_EMAIL_PATTERN.test(email))
    return showValidationError(e.currentTarget, 'forgotEmail', 'Use your @iilm.edu education email.');
  showLoading();
  try {
    const data = await apiFetch('/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    hideLoading();
    if (data.success) {
      e.currentTarget.reset();
      showToast(data.message, 'success', 8000);
    } else showValidationError(e.currentTarget, 'forgotEmail', requestError(data));
  } catch {
    hideLoading();
    showToast('Cannot connect to server.', 'error');
  }
});

$('resetPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearFieldErrors(e.currentTarget);
  const password = $('resetPassword').value;
  const confirm = $('resetConfirmPassword').value;
  const token = new URLSearchParams(window.location.search).get('resetToken');
  if (!token) return showToast('This reset link is missing or invalid.', 'error');
  if (!validPassword(password))
    return showValidationError(
      e.currentTarget,
      'resetPassword',
      'Use 12+ characters with uppercase, lowercase, number, and symbol.',
    );
  if (password !== confirm)
    return showValidationError(e.currentTarget, 'resetConfirmPassword', 'Passwords do not match.');
  showLoading();
  try {
    const data = await apiFetch('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    hideLoading();
    if (data.success) {
      window.history.replaceState({}, document.title, window.location.pathname);
      e.currentTarget.reset();
      showScreen('loginScreen');
      showToast(data.message, 'success');
    } else showValidationError(e.currentTarget, 'resetPassword', requestError(data));
  } catch {
    hideLoading();
    showToast('Cannot connect to server.', 'error');
  }
});

// Handle reset token in URL
const resetToken = new URLSearchParams(window.location.search).get('resetToken');
if (resetToken) showScreen('resetPasswordScreen');

// Handle email verify token in URL
const verifyToken = new URLSearchParams(window.location.search).get('verifyToken');
if (verifyToken) {
  (async () => {
    try {
      await loadCsrfToken();
      const data = await apiFetch('/auth/email-verify/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken }),
      });
      window.history.replaceState({}, document.title, window.location.pathname);
      showToast(
        data.success ? 'Email verified! You can now log in.' : requestError(data),
        data.success ? 'success' : 'error',
        6000,
      );
    } catch {
      showToast('Could not verify email.', 'error');
    }
  })();
}

// ===== LOGIN =====
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  resetOTPState();
  const studentId = $('studentId').value.trim();
  const password = $('password').value;
  if (!studentId || !password) return showToast('Please enter your credentials.', 'error');
  showLoading();
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ studentId, password }),
    });
    hideLoading();
    if (data.success) {
      showScreen('otpScreen');
      clearOTPBoxes();
      startOTPTimer();
      startResendTimer();
      if (data.devOtp) {
        $('otpSubtitle').innerHTML =
          `Email not configured. OTP: <strong style="font-size:22px;letter-spacing:6px;color:var(--primary)">${data.devOtp}</strong>`;
        showToast(`Dev OTP: ${data.devOtp}`, 'warning', 12000);
      } else {
        $('otpSubtitle').textContent = data.message;
        showToast(data.message, 'success');
      }
    } else {
      showToast(requestError(data), 'error');
    }
  } catch {
    hideLoading();
    showToast('Cannot connect to server. Is the backend running?', 'error');
  }
});

// ===== OTP INPUTS =====
const otpBoxes = document.querySelectorAll('.otp-box');
otpBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '');
    if (box.value) {
      box.classList.add('filled');
      if (i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
    } else box.classList.remove('filled');
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
  });
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    pasted.split('').forEach((ch, idx) => {
      if (otpBoxes[idx]) {
        otpBoxes[idx].value = ch;
        otpBoxes[idx].classList.add('filled');
      }
    });
    otpBoxes[Math.min(pasted.length, 5)].focus();
  });
});

function getOTPValue() {
  return Array.from(otpBoxes)
    .map((b) => b.value)
    .join('');
}
function clearOTPBoxes() {
  otpBoxes.forEach((b) => {
    b.value = '';
    b.classList.remove('filled');
  });
}

function resetOTPState() {
  clearOTPBoxes();
  clearInterval(countdownInterval);
  clearInterval(resendInterval);
  if ($('countdown')) $('countdown').textContent = '05:00';
  if ($('resendBtn')) {
    $('resendBtn').disabled = true;
    $('resendBtn').innerHTML =
      '<i class="fas fa-redo"></i> Resend OTP (<span id="resendCountdown">60</span>s)';
  }
  if ($('otpSubtitle')) $('otpSubtitle').textContent = 'Enter the 6-digit OTP sent to your email';
}

function startOTPTimer(minutes = 5) {
  clearInterval(countdownInterval);
  let total = minutes * 60;
  const update = () => {
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    $('countdown').textContent = `${m}:${s}`;
    if (total <= 0) {
      clearInterval(countdownInterval);
      $('countdown').textContent = 'Expired';
    }
    total--;
  };
  update();
  countdownInterval = setInterval(update, 1000);
}

function startResendTimer(seconds = 60) {
  clearInterval(resendInterval);
  const btn = $('resendBtn');
  btn.disabled = true;
  let t = seconds;
  const update = () => {
    const span = $('resendCountdown');
    if (span) span.textContent = t;
    if (t <= 0) {
      clearInterval(resendInterval);
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-redo"></i> Resend OTP';
    }
    t--;
  };
  update();
  resendInterval = setInterval(update, 1000);
}

// ===== VERIFY OTP =====
$('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const otp = getOTPValue();
  if (otp.length !== 6) return showToast('Enter the complete 6-digit OTP.', 'error');
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
  showLoading();
  try {
    const data = await apiFetch('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
    hideLoading();
    if (data.success) {
      if (data.nextStep === 'webauthn') {
        showToast('OTP verified! Complete biometric authentication.', 'success');
        showScreen('biometricScreen');
        await initBiometricLogin();
      } else {
        clearInterval(countdownInterval);
        clearInterval(resendInterval);
        onLoginSuccess(data);
      }
    } else {
      showToast(data.message, 'error');
      clearOTPBoxes();
    }
  } catch {
    hideLoading();
    showToast('Server error. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check-circle"></i> Verify OTP';
  }
});

// ===== RESEND OTP =====
async function resendOTP() {
  showLoading();
  try {
    const data = await apiFetch('/auth/otp/send', { method: 'POST' });
    hideLoading();
    if (data.success) {
      clearOTPBoxes();
      startOTPTimer();
      startResendTimer();
      if (data.devOtp) {
        $('otpSubtitle').innerHTML =
          `New OTP: <strong style="font-size:22px;letter-spacing:6px;color:var(--primary)">${data.devOtp}</strong>`;
        showToast(`New OTP: ${data.devOtp}`, 'warning', 12000);
      } else {
        $('otpSubtitle').textContent = 'New OTP sent to your email.';
        showToast('New OTP sent!', 'success');
      }
    } else showToast(data.message, 'error');
  } catch {
    hideLoading();
    showToast('Server error.', 'error');
  }
}

// ===== BIOMETRIC LOGIN (fixed — uses server challenge) =====
async function initBiometricLogin() {
  const ring = $('fingerprintRing');
  const status = $('bioStatus');
  ring.classList.remove('success', 'error', 'scanning');

  if (!window.PublicKeyCredential) {
    ring.classList.add('error');
    status.textContent = 'WebAuthn not supported on this device.';
    return;
  }

  try {
    const optData = await apiFetch('/auth/webauthn/login/options', {
      method: 'POST',
    });
    if (!optData.success) {
      ring.classList.add('error');
      status.textContent = optData.message || 'Could not start biometric.';
      return;
    }

    ring.classList.add('scanning');
    status.textContent = 'Waiting for biometric...';

    const options = optData.options;
    options.challenge = base64urlToBuffer(options.challenge);
    options.allowCredentials = (options.allowCredentials || []).map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    }));

    const credential = await navigator.credentials.get({ publicKey: options });
    ring.classList.remove('scanning');
    ring.classList.add('success');
    status.textContent = 'Biometric verified!';

    showLoading();
    const data = await apiFetch('/auth/webauthn/login/verify', {
      method: 'POST',
      body: JSON.stringify({ response: serializeCredential(credential) }),
    });
    hideLoading();

    if (data.success) onLoginSuccess(data);
    else {
      ring.classList.remove('success');
      ring.classList.add('error');
      status.textContent = 'Biometric verification failed.';
      showToast(data.message, 'error');
    }
  } catch (err) {
    ring.classList.remove('scanning');
    ring.classList.add('error');
    status.textContent = err.name === 'NotAllowedError' ? 'Biometric cancelled.' : 'Biometric failed.';
    showToast('Biometric failed. Use OTP instead.', 'warning');
  }
}

async function startBiometric() {
  await initBiometricLogin();
}

// ===== BIOMETRIC REGISTRATION (fixed — uses server challenge) =====
async function manageBiometric() {
  if (currentUser?.biometricEnabled) {
    if (!confirm('Disable biometric authentication?')) return;
    showLoading();
    const data = await apiFetch('/auth/biometric/disable', { method: 'POST' });
    hideLoading();
    if (data.success) {
      currentUser.biometricEnabled = false;
      updateBiometricUI(false);
      showToast('Biometric disabled.', 'info');
    }
    return;
  }

  if (!window.PublicKeyCredential) {
    showToast('WebAuthn not supported on this device.', 'error');
    return;
  }

  showLoading();
  try {
    const optData = await apiFetch('/auth/webauthn/register/options', {
      method: 'POST',
    });
    if (!optData.success) {
      hideLoading();
      showToast(optData.message, 'error');
      return;
    }

    const options = optData.options;
    options.challenge = base64urlToBuffer(options.challenge);
    options.user.id = base64urlToBuffer(options.user.id);
    if (options.excludeCredentials) {
      options.excludeCredentials = options.excludeCredentials.map((c) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      }));
    }

    const credential = await navigator.credentials.create({
      publicKey: options,
    });
    const data = await apiFetch('/auth/webauthn/register/verify', {
      method: 'POST',
      body: JSON.stringify({ response: serializeCredential(credential) }),
    });
    hideLoading();

    if (data.success) {
      currentUser.biometricEnabled = true;
      updateBiometricUI(true);
      showToast('Biometric registered successfully!', 'success');
    } else showToast(data.message, 'error');
  } catch (err) {
    hideLoading();
    showToast(
      err.name === 'NotAllowedError' ? 'Biometric cancelled.' : 'Biometric registration failed.',
      'warning',
    );
  }
}

// ===== WEBAUTHN HELPERS =====
function base64urlToBuffer(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function serializeCredential(credential) {
  const resp = credential.response;
  const obj = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {},
  };
  if (resp.clientDataJSON) obj.response.clientDataJSON = bufferToBase64url(resp.clientDataJSON);
  if (resp.attestationObject) obj.response.attestationObject = bufferToBase64url(resp.attestationObject);
  if (resp.authenticatorData) obj.response.authenticatorData = bufferToBase64url(resp.authenticatorData);
  if (resp.signature) obj.response.signature = bufferToBase64url(resp.signature);
  if (resp.userHandle) obj.response.userHandle = bufferToBase64url(resp.userHandle);
  if (resp.transports) obj.response.transports = resp.transports;
  return obj;
}

function updateBiometricUI(enabled) {
  const toggle = $('bioToggle');
  const btn = $('biometricBtn');
  const desc = $('bioDescription');
  if (enabled) {
    toggle.textContent = 'Enabled';
    toggle.className = 'status-badge enabled';
    btn.innerHTML = '<i class="fas fa-times-circle"></i> Disable Biometric';
    desc.textContent = 'Biometric is active. You will be prompted after OTP on next login.';
  } else {
    toggle.textContent = 'Disabled';
    toggle.className = 'status-badge disabled';
    btn.innerHTML = '<i class="fas fa-fingerprint"></i> Enable Biometric';
    desc.textContent =
      'Register your biometric to enable faster and more secure login after OTP verification.';
  }
}

// ===== ON LOGIN SUCCESS =====
function onLoginSuccess(data) {
  currentUser = data.user;
  showAuthWrapper(false);
  loadDashboard();
  loadNotifications();
  loadSessions();
  loadRecoveryCodeStatus();
  showToast(`Welcome back, ${data.user.fullName}!`, 'success');
  if (data.suspicious)
    showToast('New device detected. If this was not you, change your password.', 'warning', 8000);
}

function showAuthWrapper(show) {
  $('authWrapper').style.display = show ? 'flex' : 'none';
  $('dashboard').classList.toggle('hidden', show);
}

function isAdministrator() {
  return ['admin', 'security_admin'].includes(String(currentUser?.role || '').toLowerCase());
}

function isFaculty() {
  return String(currentUser?.role || '').toLowerCase() === 'faculty';
}

function resetPortalView() {
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelectorAll('.student-only').forEach((el) => el.classList.remove('hidden'));
  $('adminNavItem')?.classList.add('hidden');
  $('facultyNavItem')?.classList.add('hidden');
  $('tabDashboard')?.classList.add('active');
  document.querySelector('.nav-item.student-only')?.classList.add('active');
  $('topbarTitle').textContent = 'Dashboard';
}

function setupAdminPortal() {
  const adminNav = $('adminNavItem');
  const facultyNav = $('facultyNavItem');
  if (!adminNav || !facultyNav) return;
  resetPortalView();
  const isAdmin = isAdministrator();
  const faculty = isFaculty();
  adminNav.classList.toggle('hidden', !isAdmin);
  facultyNav.classList.toggle('hidden', !faculty);
  document
    .querySelectorAll('.student-only')
    .forEach((el) => el.classList.toggle('hidden', isAdmin || faculty));
  if (!isAdmin && !faculty) return;
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  if (faculty) {
    $('tabFaculty').classList.add('active');
    facultyNav.classList.add('active');
    $('topbarTitle').textContent = 'Faculty Workspace';
    $('dashUserRole').textContent = 'Faculty';
    loadFacultyWorkspace();
  } else {
    $('tabAdmin').classList.add('active');
    adminNav.classList.add('active');
    $('topbarTitle').textContent = 'Admin Portal';
    $('dashUserRole').textContent = 'Administrator';
    loadAdminStudents();
    loadSecurityDashboard();
  }
}

// ===== LOAD DASHBOARD =====
async function loadDashboard() {
  $('dashUserName').textContent = currentUser.fullName;
  $('dashUserRole').textContent = currentUser.role;
  $('welcomeName').textContent = currentUser.fullName.split(' ')[0];
  $('secStudentId').textContent = currentUser.studentId;
  $('secEmail').textContent = currentUser.email;
  $('lastLoginInfo').textContent = currentUser.lastLogin
    ? new Date(currentUser.lastLogin).toLocaleString()
    : 'First login';
  $('verifiedStatus').textContent = currentUser.isVerified ? 'Verified' : 'Not Verified';
  $('verifiedStatus').className = currentUser.isVerified ? 'text-green' : 'text-danger';
  updateBiometricUI(currentUser.biometricEnabled);

  // Profile image
  if (currentUser.profileImage) {
    $('userAvatar').innerHTML =
      `<img src="${currentUser.profileImage}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  }

  setupAdminPortal();
  if (isAdministrator() || isFaculty()) return;

  try {
    const data = await apiFetch('/portal/dashboard');
    if (!data.success) return;
    const { courses, announcements, attendance, stats } = data.data;

    $('statCGPA').textContent = stats.cgpa;
    $('statCredits').textContent = stats.totalCredits;
    $('statRank').textContent = stats.semesterRank;
    $('statCompleted').textContent = stats.completedCredits;

    $('dashCourses').innerHTML = courses.length
      ? courses
          .map(
            (c) => `
      <div class="course-item">
        <div class="course-dot"></div>
        <div class="course-item-info">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.code)} &bull; ${escapeHtml(c.instructor)}</span>
        </div>
        <span class="course-grade">${escapeHtml(c.grade)}</span>
      </div>`,
          )
          .join('')
      : '<p class="form-hint" style="padding:16px">No courses enrolled yet.</p>';

    $('dashAnnouncements').innerHTML = announcements.length
      ? announcements
          .map(
            (a) => `
      <div class="ann-item">
        <div class="ann-item-title"><span class="priority-dot priority-${a.priority}"></span>${escapeHtml(a.title)}</div>
        <div class="ann-item-date">${new Date(a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
      </div>`,
          )
          .join('')
      : '<p class="form-hint" style="padding:16px">No announcements.</p>';

    currentCourses = courses;
    renderCourses(currentCourses);

    $('attendanceList').innerHTML = attendance
      .map((a) => {
        const cls = a.percentage >= 85 ? 'good' : a.percentage >= 75 ? 'warn' : 'bad';
        return `<div class="att-card">
        <div class="att-header"><span class="att-course">${escapeHtml(a.course)}</span><span class="att-pct ${cls}">${a.percentage}%</span></div>
        <div class="att-bar-bg"><div class="att-bar ${cls}" style="width:${a.percentage}%"></div></div>
        <div class="att-detail">${a.present} / ${a.total} classes attended</div>
      </div>`;
      })
      .join('');

    $('announcementsFull').innerHTML = announcements
      .map(
        (a) => `
      <div class="ann-card ${a.priority}">
        <div class="ann-card-title"><span class="priority-dot priority-${a.priority}"></span>${escapeHtml(a.title)}</div>
        <div class="ann-card-body">${escapeHtml(a.body)}</div>
        <div class="ann-card-meta"><i class="fas fa-calendar"></i> ${new Date(a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>`,
      )
      .join('');
    loadAcademicHub();
  } catch {
    showToast('Failed to load dashboard data.', 'error');
  }
}

function renderCourses(courses) {
  $('coursesGrid').innerHTML = courses.length
    ? courses
        .map(
          (c) => `
      <div class="course-card">
        <div class="course-card-header"><div class="code">${escapeHtml(c.code)}</div><div class="name">${escapeHtml(c.name)}</div></div>
        <div class="course-card-body">
          <div class="course-detail"><i class="fas fa-user-tie"></i>${escapeHtml(c.instructor)}</div>
          <div class="course-detail"><i class="fas fa-clock"></i>${escapeHtml(c.schedule)}</div>
          <div class="course-detail"><i class="fas fa-door-open"></i>${escapeHtml(c.room)}</div>
          <div class="course-detail"><i class="fas fa-star"></i>${c.credits} Credits</div>
        </div>
        <div class="course-footer"><span style="font-size:12px;color:var(--text-muted)">Current Grade</span><span class="grade-badge">${escapeHtml(c.grade)}</span></div>
      </div>`,
        )
        .join('')
    : '<p class="form-hint">No courses match your search.</p>';
}

$('courseSearch')?.addEventListener('input', (event) => {
  const term = event.currentTarget.value.trim().toLowerCase();
  renderCourses(
    currentCourses.filter((course) =>
      [course.code, course.name, course.instructor].some((value) =>
        String(value).toLowerCase().includes(term),
      ),
    ),
  );
});

// ===== XSS HELPER =====
function escapeHtml(str) {
  return String(str ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ===== NOTIFICATIONS =====
async function loadNotifications() {
  try {
    const data = await apiFetch('/portal/notifications');
    if (!data.success) return;
    const badge = $('notifBadge');
    if (data.unreadCount > 0) {
      badge.textContent = data.unreadCount > 9 ? '9+' : data.unreadCount;
      badge.classList.remove('hidden');
    } else badge.classList.add('hidden');

    const list = $('notifList');
    list.innerHTML = data.notifications.length
      ? data.notifications
          .map(
            (n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead('${n._id}', this)">
        <div class="notif-icon ${n.type}"><i class="fas fa-${n.type === 'danger' ? 'exclamation-circle' : n.type === 'warning' ? 'exclamation-triangle' : n.type === 'success' ? 'check-circle' : 'info-circle'}"></i></div>
        <div class="notif-body"><div class="notif-title">${escapeHtml(n.title)}</div><div class="notif-time">${timeAgo(n.createdAt)}</div></div>
      </div>`,
          )
          .join('')
      : '<p class="notif-empty">No notifications</p>';
  } catch {}
}

async function markNotifRead(id, el) {
  el.classList.remove('unread');
  await apiFetch(`/portal/notifications/${id}/read`, { method: 'PATCH' });
  const badge = $('notifBadge');
  const unread = document.querySelectorAll('.notif-item.unread').length;
  if (unread === 0) badge.classList.add('hidden');
  else badge.textContent = unread > 9 ? '9+' : unread;
}

async function markAllNotifsRead() {
  await apiFetch('/portal/notifications/read-all', { method: 'PATCH' });
  document.querySelectorAll('.notif-item.unread').forEach((el) => el.classList.remove('unread'));
  $('notifBadge').classList.add('hidden');
}

function toggleNotifPanel() {
  $('notifPanel').classList.toggle('open');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ===== SESSIONS PANEL =====
async function loadSessions() {
  const container = $('sessionsList');
  container.innerHTML = '<p class="form-hint">Loading...</p>';
  try {
    const data = await apiFetch('/auth/sessions');
    if (!data.success) {
      container.innerHTML = '<p class="form-hint">Failed to load sessions.</p>';
      return;
    }
    container.innerHTML = data.sessions.length
      ? data.sessions
          .map(
            (s) => `
      <div class="session-row">
        <div class="session-info">
          <i class="fas fa-desktop"></i>
          <div>
            <div class="session-device">${escapeHtml(s.device.slice(0, 60))}${s.current ? ' <span class="session-current">current</span>' : ''}</div>
            <div class="session-meta">Last seen ${timeAgo(s.lastSeenAt)} &bull; Expires ${new Date(s.expiresAt).toLocaleDateString()}</div>
          </div>
        </div>
        ${!s.current ? `<button class="btn-ghost btn-small" onclick="revokeSession('${s.id}', this)"><i class="fas fa-sign-out-alt"></i> Sign out</button>` : ''}
      </div>`,
          )
          .join('')
      : '<p class="form-hint">No other active sessions.</p>';
  } catch {
    container.innerHTML = '<p class="form-hint">Failed to load sessions.</p>';
  }
}

async function revokeSession(id, btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  const data = await apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' });
  if (data.success) {
    btn.closest('.session-row').remove();
    showToast('Session signed out.', 'success');
  } else {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Sign out';
    showToast(data.message, 'error');
  }
}

async function signOutOtherSessions() {
  const btn = $('signOutOthersBtn');
  if (!confirm('Sign out every other device?')) return;
  btn.disabled = true;
  try {
    const data = await apiFetch('/auth/sessions', { method: 'DELETE' });
    showToast(requestError(data), data.success ? 'success' : 'error');
    if (data.success) loadSessions();
  } catch {
    showToast('Could not sign out other devices.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function loadRecoveryCodeStatus() {
  if (isAdministrator() || isFaculty()) return;
  const status = $('recoveryCodeStatus');
  if (!status) return;
  try {
    const data = await apiFetch('/auth/recovery-codes/status');
    if (!data.success) throw new Error();
    status.textContent = data.remaining
      ? `${data.remaining} unused recovery code${data.remaining === 1 ? '' : 's'} available.`
      : 'No recovery codes generated. Create codes before you need them.';
  } catch {
    status.textContent = 'Recovery-code status is unavailable.';
  }
}

async function generateRecoveryCodes() {
  if (!confirm('Generate new recovery codes? Any existing unused codes will stop working.')) return;
  showLoading();
  try {
    const data = await apiFetch('/auth/recovery-codes/generate', {
      method: 'POST',
    });
    hideLoading();
    if (!data.success) return showToast(requestError(data), 'error');
    const result = $('recoveryCodesResult');
    result.innerHTML = `<strong>Save these codes now — they will not be shown again.</strong><div class="recovery-code-grid">${data.codes.map((code) => `<code>${escapeHtml(code)}</code>`).join('')}</div>`;
    result.classList.remove('hidden');
    loadRecoveryCodeStatus();
    showToast('New recovery codes generated.', 'success');
  } catch {
    hideLoading();
    showToast('Could not generate recovery codes.', 'error');
  }
}

$('recoveryCodeForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('recoveryCode').value.trim();
  if (!code) return showToast('Enter one of your recovery codes.', 'error');
  showLoading();
  try {
    const data = await apiFetch('/auth/recovery-codes/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    hideLoading();
    if (data.success) onLoginSuccess(data);
    else showToast(requestError(data), 'error');
  } catch {
    hideLoading();
    showToast('Could not verify that recovery code.', 'error');
  }
});

async function loadAcademicHub() {
  if (isAdministrator() || isFaculty()) return;
  try {
    const data = await apiFetch('/portal/academic');
    if (!data.success) return;
    $('timetableList').innerHTML = data.timetable.length
      ? data.timetable
          .map(
            (course) => `
      <div class="academic-row"><strong>${escapeHtml(course.code)} · ${escapeHtml(course.name)}</strong><span>${escapeHtml(course.schedule)} · ${escapeHtml(course.room)}</span><small>${escapeHtml(course.instructor)}</small></div>`,
          )
          .join('')
      : '<p class="form-hint">No timetable entries yet.</p>';
    $('assignmentsList').innerHTML = data.assignments.length
      ? data.assignments
          .map(
            (assignment) => `
      <div class="academic-row"><strong>${escapeHtml(assignment.course?.code)} · ${escapeHtml(assignment.title)}</strong><span>Due ${new Date(assignment.dueAt).toLocaleString()}</span><small>${escapeHtml(assignment.description || `${assignment.maxPoints} points`)}</small></div>`,
          )
          .join('')
      : '<p class="form-hint">No upcoming assignments.</p>';
    const fees = data.fees;
    const label =
      fees.status === 'paid' ? 'Paid in full' : fees.status === 'partial' ? 'Partially paid' : 'Payment due';
    $('feeStatus').innerHTML =
      `<div class="fee-status ${escapeHtml(fees.status)}"><strong>${label}</strong><span>${fees.outstandingBalance ? `Outstanding balance: ₹${Number(fees.outstandingBalance).toLocaleString('en-IN')}` : 'No outstanding balance'}</span>${fees.paymentDueAt ? `<small>Due ${new Date(fees.paymentDueAt).toLocaleDateString()}</small>` : ''}</div>`;
  } catch {
    showToast('Could not load academic information.', 'error');
  }
}

async function downloadGradeReport() {
  try {
    const response = await fetch(`${API}/portal/academic/grade-report`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'grade-report.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast('Could not download the grade report.', 'error');
  }
}

// ===== EMAIL VERIFICATION =====
async function sendVerificationEmail() {
  const btn = $('sendVerifyBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
  try {
    const data = await apiFetch('/auth/email-verify/send', { method: 'POST' });
    showToast(
      data.success ? 'Verification email sent! Check your inbox.' : requestError(data),
      data.success ? 'success' : 'error',
    );
  } catch {
    showToast('Failed to send verification email.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-envelope"></i> Send Verification Email';
  }
}

// ===== PROFILE MANAGEMENT =====
$('profileImageInput')?.addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    showToast('Image must be under 1.5 MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    $('profilePreview').src = e.target.result;
    $('profilePreview').classList.remove('hidden');
    $('saveProfileBtn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

async function saveProfile() {
  const fullName = $('profileFullName').value.trim();
  const profileImage = $('profilePreview').src.startsWith('data:') ? $('profilePreview').src : undefined;
  if (!fullName) return showToast('Name cannot be empty.', 'error');
  showLoading();
  try {
    const body = { fullName };
    if (profileImage) body.profileImage = profileImage;
    const data = await apiFetch('/portal/profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    hideLoading();
    if (data.success) {
      currentUser.fullName = data.user.fullName;
      if (data.user.profileImage) {
        currentUser.profileImage = data.user.profileImage;
        $('userAvatar').innerHTML =
          `<img src="${data.user.profileImage}" alt="Profile" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      }
      $('dashUserName').textContent = currentUser.fullName;
      $('welcomeName').textContent = currentUser.fullName.split(' ')[0];
      $('saveProfileBtn').classList.add('hidden');
      showToast('Profile updated.', 'success');
    } else showToast(requestError(data), 'error');
  } catch {
    hideLoading();
    showToast('Failed to update profile.', 'error');
  }
}

// ===== ADMIN: STUDENTS =====
let adminPage = 1;
const ADMIN_PAGE_SIZE = 10;

$('adminStudentForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  clearFieldErrors(form);
  const studentId = $('adminStudentId').value.trim();
  const fullName = $('adminFullName').value.trim();
  const email = $('adminEmail').value.trim();
  const department = $('adminDepartment').value.trim();
  const semester = $('adminSemester').value;
  const password = $('adminPassword').value;
  const status = $('adminStatus');
  const button = $('adminCreateButton');
  const setStatus = (msg, type) => {
    status.textContent = msg;
    status.className = `admin-status ${type}`;
  };
  setStatus('', '');
  if (!studentId) return showValidationError(form, 'adminStudentId', 'Student ID is required.');
  if (!fullName) return showValidationError(form, 'adminFullName', 'Full name is required.');
  if (!email || !EDUCATION_EMAIL_PATTERN.test(email))
    return showValidationError(form, 'adminEmail', 'Use a valid @iilm.edu email.');
  if (!department) return showValidationError(form, 'adminDepartment', 'Department is required.');
  if (!semester) return showValidationError(form, 'adminSemester', 'Semester is required.');
  if (!validPassword(password))
    return showValidationError(
      form,
      'adminPassword',
      'Use 12+ chars with uppercase, lowercase, number, and symbol.',
    );
  showLoading();
  button.disabled = true;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  try {
    const data = await apiFetch('/admin/students', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        fullName,
        email,
        department,
        semester: Number(semester),
        password,
      }),
    });
    hideLoading();
    if (!data.success) {
      setStatus(requestError(data), 'error');
      return;
    }
    form.reset();
    setStatus(`Student ${studentId.toUpperCase()} created.`, 'success');
    adminPage = 1;
    loadAdminStudents();
  } catch {
    hideLoading();
    setStatus('Could not create student account.', 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-user-plus"></i> Create Student';
  }
});

async function loadAdminStudents(page = 1) {
  if (!isAdministrator()) return;
  adminPage = page;
  try {
    const search = $('adminSearch')?.value.trim() || '';
    const data = await apiFetch(
      `/admin/users?limit=${ADMIN_PAGE_SIZE}&page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    );
    if (!data.success) return showToast(requestError(data), 'error');
    const students = data.users.filter((u) => u.role === 'student' && u.adminCreated);
    $('adminStudentsList').innerHTML = students.length
      ? students
          .map(
            (s) => `
      <div class="admin-student-row">
        <div>
          <strong>${escapeHtml(s.fullName)}</strong>
          <span>${escapeHtml(s.studentId)} &bull; ${escapeHtml(s.email)}</span>
          ${s.locked ? '<span class="status-badge disabled" style="font-size:10px;padding:2px 8px;">Locked</span>' : ''}
        </div>
        <div class="admin-student-actions">
          <button class="btn-ghost btn-small" onclick="sendStudentReset('${s.id}')"><i class="fas fa-paper-plane"></i> Reset link</button>
          <button class="btn-primary btn-small" onclick="setStudentPassword('${s.id}')"><i class="fas fa-key"></i> Set password</button>
          <button class="btn-${s.locked ? 'primary' : 'ghost'} btn-small" onclick="toggleLockStudent('${s.id}', ${s.locked})">
            <i class="fas fa-${s.locked ? 'unlock' : 'lock'}"></i> ${s.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
      </div>`,
          )
          .join('')
      : '<p class="form-hint">No student accounts found.</p>';

    // Pagination
    const totalPages = Math.ceil(data.total / ADMIN_PAGE_SIZE);
    const pager = $('adminPagination');
    if (pager) {
      pager.innerHTML =
        totalPages > 1
          ? `
        <button class="btn-ghost btn-small" onclick="loadAdminStudents(${page - 1})" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
        <span style="font-size:13px;color:var(--text-muted)">Page ${page} of ${totalPages}</span>
        <button class="btn-ghost btn-small" onclick="loadAdminStudents(${page + 1})" ${page >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`
          : '';
    }
  } catch {
    showToast('Could not load student accounts.', 'error');
  }
}

async function setStudentPassword(studentId) {
  const password = window.prompt('Set a new password (12+ chars, upper/lower/number/symbol):');
  if (password === null) return;
  if (!validPassword(password)) return showToast('Password must meet the security policy.', 'error');
  showLoading();
  try {
    const data = await apiFetch(`/admin/students/${studentId}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    });
    hideLoading();
    showToast(requestError(data), data.success ? 'success' : 'error');
  } catch {
    hideLoading();
    showToast('Could not change password.', 'error');
  }
}

async function sendStudentReset(studentId) {
  showLoading();
  try {
    const data = await apiFetch(`/admin/students/${studentId}/password-reset`, {
      method: 'POST',
    });
    hideLoading();
    showToast(requestError(data), data.success ? 'success' : 'error');
  } catch {
    hideLoading();
    showToast('Could not send reset link.', 'error');
  }
}

async function toggleLockStudent(userId, currentlyLocked) {
  showLoading();
  try {
    const data = await apiFetch(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ locked: !currentlyLocked }),
    });
    hideLoading();
    if (data.success) {
      loadAdminStudents(adminPage);
      showToast(`Account ${currentlyLocked ? 'unlocked' : 'locked'}.`, 'success');
    } else showToast(requestError(data), 'error');
  } catch {
    hideLoading();
    showToast('Could not update account.', 'error');
  }
}

// ===== ADMIN: ANNOUNCEMENTS =====
$('announcementForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('annTitle').value.trim();
  const body = $('annBody').value.trim();
  const priority = $('annPriority').value;
  const targetRoles = Array.from(document.querySelectorAll('.ann-role-check:checked')).map((c) => c.value);
  if (!title || !body) return showToast('Title and body are required.', 'error');
  if (!targetRoles.length) return showToast('Select at least one target audience.', 'error');
  showLoading();
  try {
    const data = await apiFetch('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({ title, body, priority, targetRoles }),
    });
    hideLoading();
    if (data.success) {
      e.currentTarget.reset();
      showToast('Announcement posted.', 'success');
      loadAdminAnnouncements();
    } else showToast(requestError(data), 'error');
  } catch {
    hideLoading();
    showToast('Failed to post announcement.', 'error');
  }
});

async function loadAdminAnnouncements() {
  const container = $('adminAnnouncementsList');
  if (!container) return;
  try {
    const data = await apiFetch('/portal/announcements');
    if (!data.success) return;
    container.innerHTML = data.data.length
      ? data.data
          .map(
            (a) => `
      <div class="admin-student-row">
        <div><strong>${escapeHtml(a.title)}</strong><span>${a.priority} priority &bull; ${new Date(a.createdAt).toLocaleDateString()}</span></div>
        <button class="btn-ghost btn-small" onclick="deleteAnnouncement('${a._id}', this)"><i class="fas fa-trash"></i></button>
      </div>`,
          )
          .join('')
      : '<p class="form-hint">No announcements yet.</p>';
  } catch {}
}

async function deleteAnnouncement(id, btn) {
  if (!confirm('Delete this announcement?')) return;
  btn.disabled = true;
  const data = await apiFetch(`/admin/announcements/${id}`, {
    method: 'DELETE',
  });
  if (data.success) {
    btn.closest('.admin-student-row').remove();
    showToast('Deleted.', 'success');
  } else {
    btn.disabled = false;
    showToast(data.message, 'error');
  }
}

// ===== SECURITY DASHBOARD =====
async function loadSecurityDashboard() {
  const container = $('securityOverview');
  if (!container) return;
  try {
    const data = await apiFetch('/admin/security/overview');
    if (!data.success) return;
    const m = data.metrics;
    $('secMetricUsers').textContent = m.totalUsers;
    $('secMetricActive').textContent = m.activeUsers;
    $('secMetricLogins').textContent = m.successfulLogins;
    $('secMetricFailed').textContent = m.failedLogins;
    $('secMetricLocked').textContent = m.lockedAccounts;
    $('secMetricSuspicious').textContent = m.suspiciousAttempts;

    $('secEventsList').innerHTML = data.events.length
      ? data.events
          .map(
            (ev) => `
      <div class="sec-event-row outcome-${ev.outcome}">
        <span class="sec-event-badge ${ev.outcome}">${ev.outcome}</span>
        <span class="sec-event-name">${escapeHtml(ev.event)}</span>
        <span class="sec-event-user">${ev.user ? escapeHtml(ev.user.name) : 'Unknown'}</span>
        <span class="sec-event-time">${timeAgo(ev.at)}</span>
      </div>`,
          )
          .join('')
      : '<p class="form-hint">No recent events.</p>';
  } catch {
    container.innerHTML = '<p class="form-hint">Failed to load security data.</p>';
  }
}

async function downloadSecurityLogs() {
  try {
    const response = await fetch(`${API}/admin/security/logs/export`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'security-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    showToast('Could not export the security audit log.', 'error');
  }
}

async function loadFacultyWorkspace() {
  const container = $('facultyCourses');
  if (!container) return;
  container.innerHTML = '<p class="form-hint">Loading assigned courses...</p>';
  try {
    const data = await apiFetch('/portal/faculty/courses');
    if (!data.success) throw new Error();
    container.innerHTML = data.courses.length
      ? data.courses
          .map(
            (course) => `
      <article class="faculty-course-card">
        <header><div><span>${escapeHtml(course.code)}</span><h3>${escapeHtml(course.name)}</h3></div><small>${course.students.length} student${course.students.length === 1 ? '' : 's'}</small></header>
        <div class="faculty-roster">${
          course.students.length
            ? course.students
                .map(
                  (entry) => `
          <div class="faculty-student-row"><div><strong>${escapeHtml(entry.student?.fullName || 'Unknown student')}</strong><span>${escapeHtml(entry.student?.studentId || '')} · Grade ${escapeHtml(entry.grade)} · ${entry.attendancePresent}/${entry.attendanceTotal} attendance</span></div><button class="btn-ghost btn-small" onclick="editFacultyRecord('${entry.enrollmentId}')">Update</button></div>`,
                )
                .join('')
            : '<p class="form-hint">No students enrolled.</p>'
        }</div>
      </article>`,
          )
          .join('')
      : '<p class="form-hint">No courses are assigned to your faculty account.</p>';
  } catch {
    container.innerHTML = '<p class="form-hint">Could not load faculty courses.</p>';
  }
}

async function editFacultyRecord(enrollmentId) {
  const grade = prompt('Grade (for example A, B+, or N/A):');
  if (grade === null) return;
  const attendancePresent = prompt('Classes attended:');
  if (attendancePresent === null) return;
  const attendanceTotal = prompt('Total classes:');
  if (attendanceTotal === null) return;
  if (
    !/^\d+$/.test(attendancePresent) ||
    !/^\d+$/.test(attendanceTotal) ||
    Number(attendancePresent) > Number(attendanceTotal)
  ) {
    return showToast(
      'Attendance must be whole numbers, with attended classes no greater than total.',
      'error',
    );
  }
  try {
    const data = await apiFetch(`/portal/faculty/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        grade: grade.trim(),
        attendancePresent: Number(attendancePresent),
        attendanceTotal: Number(attendanceTotal),
      }),
    });
    showToast(requestError(data), data.success ? 'success' : 'error');
    if (data.success) loadFacultyWorkspace();
  } catch {
    showToast('Could not update the student record.', 'error');
  }
}

// ===== TAB NAVIGATION =====
async function loadAnnouncements() {
  const container = $('announcementsFull');
  if (!container) return;
  try {
    const data = await apiFetch('/portal/announcements');
    if (!data.success) return;
    const announcements = data.data || [];
    container.innerHTML = announcements.length
      ? announcements
          .map(
            (a) => `
      <div class="ann-card ${a.priority}">
        <div class="ann-card-title"><span class="priority-dot priority-${a.priority}"></span>${escapeHtml(a.title)}</div>
        <div class="ann-card-body">${escapeHtml(a.body)}</div>
        <div class="ann-card-meta"><i class="fas fa-calendar"></i> ${new Date(a.createdAt || a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>`,
          )
          .join('')
      : '<p class="form-hint">No announcements yet.</p>';
  } catch {}
}

function showTab(tabId, navEl) {
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  $(tabId).classList.add('active');
  navEl.classList.add('active');
  const titles = {
    tabDashboard: 'Dashboard',
    tabCourses: 'My Courses',
    tabAttendance: 'Attendance',
    tabAnnouncements: 'Announcements',
    tabSecurity: 'Security Settings',
    tabAcademic: 'Academic Hub',
    tabAdmin: 'Admin Portal',
    tabFaculty: 'Faculty Workspace',
  };
  $('topbarTitle').textContent = titles[tabId] || '';
  if (tabId === 'tabSecurity') loadSessions();
  if (tabId === 'tabAcademic') loadAcademicHub();
  if (tabId === 'tabAnnouncements') loadAnnouncements();
  if (tabId === 'tabAdmin') {
    loadAdminStudents();
    loadAdminAnnouncements();
    loadSecurityDashboard();
  }
  if (tabId === 'tabFaculty') loadFacultyWorkspace();
}

// ===== SIDEBAR =====
function toggleSidebar() {
  $('sidebar').classList.toggle('open');
}

// Close notif panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = $('notifPanel');
  const btn = $('notifBtn');
  if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
    panel.classList.remove('open');
  }
});

// ===== LOGOUT =====
async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {}
  currentUser = null;
  csrfToken = null;
  resetOTPState();
  resetPortalView();
  showAuthWrapper(true);
  showScreen('loginScreen');
  $('loginForm').reset();
  showToast('Logged out successfully.', 'info');
}

// ===== INIT =====
currentUser = null;
resetPortalView();
showAuthWrapper(true);
showScreen('loginScreen');
