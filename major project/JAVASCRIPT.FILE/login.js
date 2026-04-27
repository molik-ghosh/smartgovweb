/**
 * ============================================================
 * login.js — SmartGovWeb Authentication Module
 * ============================================================
 * Handles login, signup, password reset, and user record creation.
 * Uses Firebase Auth v10 (modular) and Realtime Database.
 *
 * Sections:
 *   1. Firebase Imports & Config
 *   2. DOM Elements
 *   3. Auth State Observer
 *   4. Helper Functions (errors, feedback)
 *   5. Core Auth Functions (login, signup, reset)
 *   6. UI Toggle Functions
 *   7. Event Listeners
 * ============================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  update,
  get,
  child,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/** @type {Object} Firebase project configuration */
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ── 2. DOM Elements ──────────────────────────────
const authContainer = document.getElementById("auth-container");
const emailInput = document.getElementById("email");
const passInput = document.getElementById("password");
const actionBtn = document.getElementById("action-btn");
const toggleMode = document.getElementById("toggle-mode");
const formTitle = document.getElementById("form-title");
const errorMsg = document.getElementById("error-msg");
const successMsg = document.getElementById("success-msg");
const toggleIcon = document.getElementById("toggle-icon");

let isLoginMode = true;

/** URL to redirect after successful authentication */
const MAIN_PAGE_URL = "./index1.html";

// ── 3. Auth State Observer ───────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = MAIN_PAGE_URL;
  }
  authContainer.classList.remove("hidden");
});

// ── 4. Helper Functions ──────────────────────────

/**
 * Maps Firebase auth error codes to user-friendly messages.
 * @param {string} code - Firebase error code
 * @returns {string} Human-readable error message
 */
function friendlyError(code) {
  const map = {
    "auth/user-not-found": "⚠️ Email not found. Please create an account.",
    "auth/wrong-password": "⚠️ Wrong password.",
    "auth/invalid-email": "⚠️ Please enter a valid email address.",
    "auth/email-already-in-use": "⚠️ Account exists! Please login or reset password.",
    "auth/weak-password": "⚠️ Password must be at least 6 characters.",
    "auth/too-many-requests": "⚠️ Too many failed attempts. Try again later.",
    "auth/network-request-failed": "⚠️ Network error. Check your connection.",
    "auth/invalid-credential": "⚠️ Invalid credentials."
  };
  return map[code] || "⚠️ Something went wrong. Please try again.";
}

/**
 * Displays feedback message in the appropriate banner.
 * @param {string} msg - Message text
 * @param {"error"|"success"} type - Feedback type
 */
function showFeedback(msg, type) {
  if (type === "error") {
    errorMsg.textContent = msg;
    errorMsg.style.display = "block";
    successMsg.style.display = "none";
  } else {
    successMsg.textContent = msg;
    successMsg.style.display = "block";
    errorMsg.style.display = "none";
  }
}

// ── 5. Core Auth Functions ───────────────────────

/**
 * Sends a password reset email to the given address.
 * @param {string} email - User email
 * @returns {Promise<boolean>} True if email sent successfully
 */
async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    showFeedback("✅ Password reset email sent! Check your inbox.", "success");
    return true;
  } catch (error) {
    showFeedback("❌ Reset failed: " + friendlyError(error.code), "error");
    return false;
  }
}

/**
 * Creates or updates a sequential user record in the database.
 * Migrates legacy data from user1/{uid} if present.
 * @param {Object} user - Firebase user object
 * @param {string} email - User email
 * @returns {Promise<string>} The user key (e.g., "user1")
 */
async function createSequentialUserRecord(user, email) {
  const rootRef = ref(db);
  const usersSnapshot = await get(child(rootRef, "users"));
  const usersData = usersSnapshot.val() || {};

  const existingUserKey = Object.keys(usersData).find((key) => usersData[key]?.email === email);
  if (existingUserKey) {
    await update(ref(db, `users/${existingUserKey}`), { email });
    return existingUserKey;
  }

  const legacySnapshot = await get(child(rootRef, `user1/${user.uid}`));
  const userNumbers = Object.keys(usersData)
    .map((key) => {
      const match = /^user(\d+)$/.exec(key);
      return match ? Number(match[1]) : 0;
    })
    .filter(Boolean);
  const nextNumber = (userNumbers.length ? Math.max(...userNumbers) : 0) + 1;
  const userKey = `user${nextNumber}`;
  const legacyData = legacySnapshot.val() || {};

  await update(ref(db, `users/${userKey}`), {
    email,
    officialName: legacyData.officialName || legacyData.name || "",
    age: legacyData.age ?? null,
    gender: legacyData.gender || "",
    contact: legacyData.contact || legacyData.phone || "",
    photoURL: legacyData.photoURL || "",
  });

  return userKey;
}

/**
 * Main auth handler: validates input, then logs in or signs up.
 */
async function handleAuth() {
  const email = emailInput.value.trim();
  const password = passInput.value;

  if (!email || !password) {
    showFeedback("Please fill in all fields.", "error");
    return;
  }

  actionBtn.disabled = true;
  actionBtn.textContent = isLoginMode ? "Logging in..." : "Creating account...";

  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = MAIN_PAGE_URL;
    } else {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await createSequentialUserRecord(userCredential.user, email);
      showFeedback("Account created! Logging in...", "success");
      setTimeout(() => window.location.href = MAIN_PAGE_URL, 1500);
    }
  } catch (err) {
    if (isLoginMode && (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found')) {
      const resetConfirmed = confirm("Wrong password? Reset it now?");
      if (resetConfirmed) {
        await resetPassword(email);
      }
    }
    showFeedback(friendlyError(err.code), "error");
  } finally {
    actionBtn.disabled = false;
    actionBtn.textContent = isLoginMode ? "Login" : "Sign Up";
  }
}

// ── 6. UI Toggle Functions ───────────────────────

/** Switches between login and signup modes */
function toggleModeClick() {
  isLoginMode = !isLoginMode;
  formTitle.textContent = isLoginMode ? "Login" : "Sign Up";
  actionBtn.textContent = isLoginMode ? "Login" : "Sign Up";
  actionBtn.className = isLoginMode ? "btn-login" : "btn-signup";
  toggleMode.textContent = isLoginMode
    ? "Don't have an account? Sign Up"
    : "Already have an account? Login";
  errorMsg.style.display = "none";
  successMsg.style.display = "none";
}

/** Toggles password input visibility between text and password */
function togglePasswordVisibility() {
  const isPassword = passInput.type === "password";
  passInput.type = isPassword ? "text" : "password";
  toggleIcon.style.fill = isPassword ? "#333" : "#888";
}

// ── 7. Event Listeners ───────────────────────────
actionBtn.addEventListener("click", handleAuth);
toggleMode.addEventListener("click", toggleModeClick);
toggleIcon.addEventListener("click", togglePasswordVisibility);

document.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    handleAuth();
  }
});
