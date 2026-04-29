/**
 * ============================================================
 * profile.js — SmartGovWeb Profile Editor Logic
 * ============================================================
 * Handles profile data loading, editing, photo upload preview,
 * form validation, and saving to Firebase Realtime Database.
 * Runs inside the profile iframe modal.
 *
 * Sections:
 *   1. Firebase Config & Initialization
 *   2. DOM Element References
 *   3. Auth State & Profile Loading
 *   4. User Key Management
 *   5. Form Validation
 *   6. Save & Reset Handlers
 *   7. UI Helpers
 * ============================================================
 */

/** Firebase project configuration (shared across app) */
const firebaseConfig = {
  apiKey: "AIzaSyBejoCp3WwPnkYS8bdhf6A76UeHBTuSTqY",
  authDomain: "fir-contact-2ece7.firebaseapp.com",
  databaseURL:
    "https://fir-contact-2ece7-default-rtdb.firebaseio.com",
  projectId: "fir-contact-2ece7",
  storageBucket: "fir-contact-2ece7.firebasestorage.app",
  messagingSenderId: "694459518889",
  appId: "1:694459518889:web:c738883ad5627139affeb8"
};

// ── 1. Firebase Config & Initialization ──────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ── 2. DOM Element References ────────────────────

/** Main action button */
const saveBtn = document.getElementById('saveBtn');
/** Profile edit form */
const profileForm = document.getElementById('profileForm');
/** Hidden file input for photo upload */
const photoInput = document.getElementById('photoInput');
/** Avatar display container */
const avatarImg = document.getElementById('avatarImg');
/** Success toast message element */
const successMsg = document.getElementById('successMsg');

/** Form field elements */
const fields = {
  officialName: document.getElementById('officialName'),
  age: document.getElementById('age'),
  contact: document.getElementById('contact'),
  gender: document.getElementById('gender')
};

/** Display elements for read-only info */
const displayName = document.getElementById('displayName');
const displayEmail = document.getElementById('displayEmail');

// ── 3. Auth State & Profile Loading ──────────────

/**
 * Watches auth state and loads profile when user is authenticated.
 * Closes the iframe if no user is logged in.
 */
auth.onAuthStateChanged(async (user) => {
  if (user) {
    await loadProfile(user);
    window.profileUser = user; // Expose globally for save handler
  } else {
    window.close(); // Close popup if not logged in
  }
});

/**
 * Loads user profile data from Firebase and populates the form.
 * Creates a new record if none exists.
 * @param {Object} user - Firebase auth user
 */
async function loadProfile(user) {
  try {
    const userKey = await getOrCreateUserKey(user);
    const userRef = db.ref('users/' + userKey);
    const snapshot = await userRef.once('value');
    const existingData = snapshot.val();

    if (!existingData) {
      await userRef.set({
        email: user.email || '',
        officialName: '',
        age: null,
        gender: '',
        contact: ''
      });
    }

    const refreshedSnapshot = existingData ? snapshot : await userRef.once('value');
    window.originalProfileData = refreshedSnapshot.val() || {}; // Store for change detection

    const data = window.originalProfileData;

    // Populate display fields
    if (displayName) displayName.textContent = data.officialName || user.email.split('@')[0] || 'User';
    if (displayEmail) displayEmail.textContent = data.email || user.email;

    // Populate form fields
    if (fields.officialName) fields.officialName.value = data.officialName || '';
    if (fields.age) fields.age.value = data.age || '';
    if (fields.contact) fields.contact.value = data.contact || '';
    if (fields.gender) fields.gender.value = data.gender || '';

    // Render avatar (photo or fallback icon)
    const avatarElement = document.getElementById('avatarImg');
    if (data.photoURL) {
      const imgHtml = `<img src="${data.photoURL}" alt="Profile Photo" class="avatar-img">`;
      avatarElement.innerHTML = imgHtml;
    } else {
      avatarElement.innerHTML = `<i class="fas fa-user"></i>`;
    }

  } catch (error) {
    console.error('Load profile error:', error);
  }
}

// ── 4. User Key Management ───────────────────────

/**
 * Finds existing user key by email, or creates a new sequential one.
 * Migrates legacy data from user1/{uid} if present.
 * @param {Object} user - Firebase auth user
 * @returns {Promise<string>} User key (e.g., "user1")
 */
async function getOrCreateUserKey(user) {
  const usersSnapshot = await db.ref('users').once('value');
  const usersData = usersSnapshot.val() || {};
  const existingKey = Object.keys(usersData).find((key) => usersData[key]?.email === user.email);

  if (existingKey) {
    return existingKey;
  }

  const legacySnapshot = await db.ref('user1/' + user.uid).once('value');
  const legacyData = legacySnapshot.val() || {};

  const userNumbers = Object.keys(usersData)
    .map((key) => {
      const match = /^user(\d+)$/.exec(key);
      return match ? Number(match[1]) : 0;
    })
    .filter(Boolean);

  const userKey = 'user' + ((userNumbers.length ? Math.max(...userNumbers) : 0) + 1);
  await db.ref('users/' + userKey).set({
    email: user.email || '',
    officialName: legacyData.officialName || legacyData.name || '',
    age: legacyData.age ?? null,
    gender: legacyData.gender || '',
    contact: legacyData.contact || legacyData.phone || '',
    photoURL: legacyData.photoURL || ''
  });

  return userKey;
}

// ── 5. Form Validation ───────────────────────────

/**
 * Checks if form data differs from originally loaded data.
 * @param {Object} original - Data loaded from Firebase
 * @param {Object} current - Current form values
 * @returns {boolean} True if any field changed
 */
function hasChanges(original, current) {
  return (
    (original.officialName || '') !== (current.officialName || '') ||
    (original.age || null) !== (current.age || null) ||
    (original.contact || '') !== (current.contact || '') ||
    (original.gender || '') !== (current.gender || '')
  );
}

// ── 6. Save & Reset Handlers ─────────────────────

/**
 * Main save handler: validates input, checks for changes,
 * uploads photo if selected, and saves to Firebase.
 * @param {Event} event - Click event
 */
window.handleSave = async (event) => {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.disabled = true;

  if (!window.profileUser) {
    alert('User not authenticated');
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  // Validate all fields
  const errors = [];
  const name = fields.officialName?.value?.trim() || '';
  if (!name || name.length < 2) errors.push('Official Name: At least 2 characters');

  const ageVal = fields.age?.value;
  const age = parseInt(ageVal);
  if (ageVal && (isNaN(age) || age < 18 || age > 100)) errors.push('Age: 18-100 years');

  const gender = fields.gender?.value;
  if (!gender) errors.push('Gender: Please select');

  const contact = fields.contact?.value?.trim() || '';
  if (contact && !/^\d{10,15}$/.test(contact.replace(/\D/g, ''))) errors.push('Contact: 10-15 digits only');

  if (errors.length > 0) {
    alert('Please fix:\n' + errors.join('\n'));
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  // Check for changes before saving
  const normalizedData = {
    officialName: name,
    age: age || null,
    contact,
    gender,
  };

  if (!window.originalProfileData || hasChanges(window.originalProfileData, normalizedData)) {
    const data = {
      email: window.profileUser.email || '',
      ...normalizedData
    };

    const file = photoInput?.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async () => {
        data.photoURL = reader.result;
        await saveData(data);
        if (saveBtn) saveBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    } else {
      await saveData(data);
      if (saveBtn) saveBtn.disabled = false;
    }
  } else {
    alert('No changes detected');
    if (saveBtn) saveBtn.disabled = false;
  }
};

/**
 * Saves profile data to Firebase and shows success feedback.
 * @param {Object} data - Profile data to save
 */
async function saveData(data) {
  try {
    const userKey = await getOrCreateUserKey(window.profileUser);
    await db.ref('users/' + userKey).update(data);
    showSuccess('Profile saved successfully!');

    // Refresh display with new data
    loadProfile(window.profileUser);

    // Auto-close popup after 1.5s
    setTimeout(() => {
      window.parent.postMessage('closeProfile', '*');
      window.close();
    }, 1500);
  } catch (error) {
    alert('Save error: ' + error.message);
  }
}

/** Resets form to last saved values */
window.handleReset = () => {
  if (window.profileUser) {
    loadProfile(window.profileUser);
  }
};

/** Navigates back / closes the profile iframe */
window.goBack = () => {
  console.log('Back arrow clicked - sending close message');
  window.parent.postMessage('closeProfile', '*');
  window.close();
};

// ── 7. UI Helpers ────────────────────────────────

/** Photo upload preview handler */
if (photoInput) {
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (avatarImg) {
          const previewHtml = `<img src="${e.target.result}" alt="Profile Photo" class="avatar-img" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
          avatarImg.innerHTML = previewHtml;
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

/** Shows a temporary success toast message */
function showSuccess(msg) {
  successMsg.textContent = msg;
  successMsg.classList.remove('hidden');
  setTimeout(() => successMsg.classList.add('hidden'), 3000);
}

// Escape key closes the modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

// Prevent zoom on mobile devices
document.addEventListener('touchstart', function() {}, true);
