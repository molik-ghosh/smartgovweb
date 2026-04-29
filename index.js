/**
 * ============================================================
 * index.js — SmartGovWeb Citizen Portal Core
 * ============================================================
 * Main application logic for the citizen portal homepage.
 * Manages: Firebase auth, admin checks, area directory cards,
 * profile dropdown, page switching, and data CRUD operations.
 *
 * Sections:
 *   1. Firebase Imports & Config
 *   2. Constants & DOM References
 *   3. Loading & Page Reveal
 *   4. Auth & Profile Utilities
 *   5. UI Event Bindings
 *   6. Area Data Builders (cards, forms)
 *   7. Admin Panel Logic
 *   8. Initialization
 * ============================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  child,
  get,
  getDatabase,
  onValue,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

/** @type {Object} Firebase project configuration */
const firebaseConfig = {
  apiKey: "AIzaSyBejoCp3WwPnkYS8bdhf6A76UeHBTuSTqY",
  authDomain: "fir-contact-2ece7.firebaseapp.com",
  databaseURL: "https://fir-contact-2ece7-default-rtdb.firebaseio.com",
  projectId: "fir-contact-2ece7",
  storageBucket: "fir-contact-2ece7.firebasestorage.app",
  messagingSenderId: "694459518889",
  appId: "1:694459518889:web:c738883ad5627139affeb8",
};

const LOGIN_PAGE = "../HTML_FILES/login.html";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let appInitialized = false;
let loadingFallbackTimer = null;
const MIN_LOADING_TIME = 800; // Minimum loading screen display time in ms
const loadStartTime = Date.now();

/** Cached DOM element references to avoid repeated querySelector calls */
const dom = {
  loadingScreen: document.getElementById("loading-screen"),
  appContent: document.getElementById("app-content"),
  profileBtn: document.getElementById("profile-btn"),
  profileDropdown: document.getElementById("profile-dropdown"),
  profileInitials: document.getElementById("profile-initials"),
  dropdownAvatar: document.getElementById("dropdown-avatar"),
  dropdownName: document.getElementById("dropdown-name"),
  dropdownEmail: document.getElementById("dropdown-email"),
  logoutBtn: document.getElementById("logout-btn"),
  profileModal: document.getElementById("profileModal"),
  profileBtnTrigger: document.getElementById("profileBtn"),
  mapUrlInput: document.getElementById("map-url"),
  mapPreviewContainer: document.getElementById("map-preview-container"),
  mapPreviewIframe: document.getElementById("map-preview"),
  adminButton: document.getElementById("btn-admin"),
  adminButtonLink: document.getElementById("admin-nav-link"),
  dataGrid: document.getElementById("data-grid"),
  searchInput: document.getElementById("searchInput"),
};

// Expose config for child iframes
window.firebaseConfig = firebaseConfig;

// ── 3. Loading & Page Reveal ─────────────────────

/** Calculates remaining time to meet MIN_LOADING_TIME, then reveals page */
function revealPage() {
  const elapsed = Date.now() - loadStartTime;
  const remaining = Math.max(0, MIN_LOADING_TIME - elapsed);

  setTimeout(() => {
    if (dom.loadingScreen) dom.loadingScreen.style.display = "none";
    if (dom.appContent) dom.appContent.style.display = "block";
    document.body.style.opacity = "1";
  }, remaining);
}

/**
 * Sets a fallback timer: if auth takes too long, force-hide loader
 * and initialize the app in guest mode.
 */
function hideLoadingWithFallback() {
  if (!dom.loadingScreen || !dom.appContent) {
    revealPage();
    return;
  }

  loadingFallbackTimer = window.setTimeout(() => {
    if (appInitialized) return;
    revealPage();
    initSmartGovApp(false);
  }, 5000);
}

// ── 4. Auth & Profile Utilities ──────────────────

/**
 * Returns first 2 uppercase characters of a string for avatar initials.
 * @param {string} value
 * @returns {string}
 */
function getInitials(value) {
  return (value || "?").trim().slice(0, 2).toUpperCase() || "?";
}

/** Escapes HTML special characters to prevent XSS */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes single quotes for safe use in inline JS strings */
function escapeJsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

/** Validates that a URL looks like a Google Maps embed link */
function isValidMapUrl(url) {
  return (
    typeof url === "string" &&
    (url.includes("share.google") ||
      url.includes("maps.google.com/maps/d/embed") ||
      url.includes("google.com/maps/embed") ||
      url.includes("maps.app.goo.gl") ||
      url.includes("google.com/maps/d/embed") ||
      url.includes("www.google.com/maps"))
  );
}

/**
 * Finds existing user key by email, or creates a new sequential one.
 * Migrates legacy data from user1/{uid} if present.
 * @param {Object} user - Firebase user
 * @returns {Promise<string>} User key (e.g., "user1")
 */
async function getOrCreateUserKey(user) {
  const rootRef = ref(db);
  const usersSnapshot = await get(child(rootRef, "users"));
  const usersData = usersSnapshot.val() || {};
  const existingKey = Object.keys(usersData).find(
    (key) => usersData[key]?.email === user.email,
  );

  if (existingKey) {
    return existingKey;
  }

  const legacySnapshot = await get(child(rootRef, `user1/${user.uid}`));
  const legacyData = legacySnapshot.val() || {};
  const userNumbers = Object.keys(usersData)
    .map((key) => {
      const match = /^user(\d+)$/.exec(key);
      return match ? Number(match[1]) : 0;
    })
    .filter(Boolean);

  const userKey = `user${(userNumbers.length ? Math.max(...userNumbers) : 0) + 1}`;
  await update(ref(db, `users/${userKey}`), {
    email: user.email || "",
    officialName: legacyData.officialName || legacyData.name || "",
    age: legacyData.age ?? null,
    gender: legacyData.gender || "",
    contact: legacyData.contact || legacyData.phone || "",
    photoURL: legacyData.photoURL || "",
  });

  return userKey;
}

/** Ensures the current user has a database record with email set */
async function ensureUserRecord(user) {
  try {
    const userKey = await getOrCreateUserKey(user);
    const userRef = ref(db, `users/${userKey}`);
    const snapshot = await get(userRef);
    const userData = snapshot.val() || {};
    if (!userData.email && user.email) {
      await update(userRef, { email: user.email });
    }
  } catch (error) {
    console.error("User record sync error:", error);
  }
}

/**
 * Fetches profile data and updates the avatar + dropdown display.
 * @param {Object} user - Firebase user
 */
async function updateProfileDisplay(user) {
  if (
    !user ||
    !dom.profileInitials ||
    !dom.dropdownAvatar ||
    !dom.dropdownName ||
    !dom.dropdownEmail
  ) {
    return;
  }

  try {
    const userKey = await getOrCreateUserKey(user);
    const snapshot = await get(ref(db, `users/${userKey}`));
    const data = snapshot.val() || {};
    const name = data.officialName || user.email?.split("@")[0] || "User";
    const email = data.email || user.email || "";
    const initials = getInitials(name);

    dom.dropdownName.textContent = name;
    dom.dropdownEmail.textContent = email;

    if (data.photoURL) {
      const imageHtml = `<img src="${escapeHtml(data.photoURL)}" alt="Avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      dom.profileInitials.innerHTML = imageHtml;
      dom.dropdownAvatar.innerHTML = imageHtml;
    } else {
      dom.profileInitials.textContent = initials;
      dom.dropdownAvatar.textContent = initials;
    }
  } catch (error) {
    console.error("Profile load error:", error);
    const name = user.email?.split("@")[0] || "User";
    const initials = getInitials(name);
    dom.profileInitials.textContent = initials;
    dom.dropdownAvatar.textContent = initials;
    dom.dropdownName.textContent = name;
    dom.dropdownEmail.textContent = user.email || "";
  }
}

// ── 5. UI Event Bindings ─────────────────────────

/** Attaches click/keyboard handlers for shared UI components */
function bindSharedUi() {
  // Profile dropdown toggle
  if (dom.profileBtn && dom.profileDropdown) {
    dom.profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      dom.profileDropdown.classList.toggle("open");
    });

    dom.profileDropdown.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener("click", () => {
    dom.profileDropdown?.classList.remove("open");
  });

  // Open profile iframe modal
  if (dom.profileBtnTrigger && dom.profileModal) {
    dom.profileBtnTrigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dom.profileDropdown?.classList.remove("open");
      dom.profileModal.classList.add("active");
      document.body.style.overflow = "hidden";
    });
  }

  // Close modal on backdrop click
  dom.profileModal?.addEventListener("click", (event) => {
    if (event.target === dom.profileModal) {
      dom.profileModal.classList.remove("active");
      document.body.style.overflow = "";
    }
  });

  // Escape key closes modal
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      dom.profileModal?.classList.contains("active")
    ) {
      dom.profileModal.classList.remove("active");
      document.body.style.overflow = "";
    }
  });

  // Listen for iframe close message
  window.addEventListener("message", (event) => {
    if (event.data === "closeProfile") {
      dom.profileModal?.classList.remove("active");
      document.body.style.overflow = "";
    }
  });

  // Logout handler
  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        localStorage.removeItem("loggedEmail");
        window.location.href = LOGIN_PAGE;
      } catch (error) {
        alert(`Logout failed: ${error.message}`);
      }
    });
  }

  // Map URL preview in admin form
  if (dom.mapUrlInput && dom.mapPreviewContainer && dom.mapPreviewIframe) {
    dom.mapUrlInput.addEventListener("input", () => {
      const url = dom.mapUrlInput.value.trim();
      if (url && isValidMapUrl(url)) {
        dom.mapPreviewIframe.src = url;
        dom.mapPreviewContainer.style.display = "block";
      } else {
        dom.mapPreviewContainer.style.display = "none";
        dom.mapPreviewIframe.src = "";
      }
    });
  }

  // "More" dropdown toggle
  window.toggleMoreDropdown = function toggleMoreDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById("more-menu");
    if (!menu) return;

    const isOpen = menu.classList.contains("show");
    document
      .querySelectorAll(".more-menu.show")
      .forEach((item) => item.classList.remove("show"));

    if (!isOpen) {
      menu.classList.add("show");
    }

    const closeMenu = (closeEvent) => {
      const moreButton = document.getElementById("more-btn");
      if (
        !menu.contains(closeEvent.target) &&
        closeEvent.target !== moreButton
      ) {
        menu.classList.remove("show");
        document.removeEventListener("click", closeMenu);
      }
    };

    window.setTimeout(() => document.addEventListener("click", closeMenu), 0);
  };
}

// ── 6. Area Data Builders ────────────────────────

/**
 * Normalizes text fields in area data by trimming and cleaning commas.
 * @param {Object} rawInfo - Raw area info from database
 * @returns {Object} Sanitized area info
 */
function sanitizeAreaInfo(rawInfo) {
  if (!rawInfo) return rawInfo;

  const info = { ...rawInfo };
  const fields = [
    "JE",
    "EE",
    "SE",
    "Vidhayak",
    "JEContact",
    "EEContact",
    "SEContact",
    "VidhayakContact",
    "workDetails",
  ];

  fields.forEach((field) => {
    if (info[field]) {
      info[field] = String(info[field])
        .trim()
        .replace(/\n\s*,\s*\n/g, ", ");
    }
  });

  return info;
}

/**
 * Returns HTML for a colored status badge.
 * @param {string} status - Work status string
 * @returns {string} HTML badge markup
 */
function getStatusBadge(status) {
  const statusMap = {
    Pending: { cls: "pending", icon: "🔴" },
    "In Progress": { cls: "in-progress", icon: "🟡" },
    Completed: { cls: "completed", icon: "🟢" },
  };

  const normalized = statusMap[status] || statusMap.Pending;
  return `<span class="status-badge ${normalized.cls}">${normalized.icon} ${escapeHtml(status || "Pending")}</span>`;
}

/**
 * Builds a DOM element for an area directory card.
 * @param {string} areaName - Name of the area
 * @param {Object} rawInfo - Raw area data
 * @param {boolean} isAdmin - Whether admin buttons should show
 * @returns {HTMLElement} Card DOM element
 */
function buildAreaCard(areaName, rawInfo, isAdmin) {
  const info = sanitizeAreaInfo(rawInfo);
  const card = document.createElement("div");
  card.className = "card";

  const infoRow = (label, value, contact) => `
    <div class="info-row">
      <span class="info-label">${label}</span>
      <span class="info-value">
        ${escapeHtml(value || "N/A")}<br>
        <small style="color:#666;font-size:0.85em;">📞 ${escapeHtml(contact || "N/A")}</small>
      </span>
    </div>
  `;

  const mapSection =
    info.mapUrl && isValidMapUrl(info.mapUrl)
      ? `
      <div class="card-map">
        <div class="card-map-label"><i class="fas fa-map-marker-alt"></i> Location Map</div>
        <iframe src="${escapeHtml(info.mapUrl)}" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="border:0;"></iframe>
      </div>
    `
      : `
      <div class="card-map">
        <div class="no-map"><i class="fas fa-map" style="opacity:0.3;font-size:1.5rem;"></i><br>No valid map URL</div>
    `;

  const workSection = info.workDetails
    ? `
      <div class="card-work-details">
        <div class="detail-label"><i class="fas fa-clipboard-list"></i> Work Details</div>
        <p>${escapeHtml(info.workDetails)}</p>
      </div>
    `
    : "";

  const adminButtons = isAdmin
    ? `
      <div style="display:flex;gap:6px;">
        <button class="btn-edit" onclick="editData('${escapeJsString(areaName)}')">
          <i class="fas fa-pen"></i> Edit
        </button>
        <button class="btn-danger" onclick="deleteData('${escapeJsString(areaName)}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `
    : "";

  card.innerHTML = `
    <div class="card-header">
      <h3><i class="fas fa-map-marker-alt"></i> ${escapeHtml(areaName)}</h3>
      ${adminButtons}
    </div>
    ${mapSection}
    ${workSection}
    <div class="card-details-toggle" onclick="toggleDetails(this)">
      <i class="fas fa-chevron-down"></i> View Engineer Details
    </div>
    <div class="card-body card-body-hidden">
      ${infoRow("👷 Junior Engineer", info.JE, info.JEContact)}
      ${infoRow("🏗️ Executive Engineer", info.EE, info.EEContact)}
      ${infoRow("🔧 Sub Divisional Eng.", info.SE, info.SEContact)}
      ${infoRow("👨‍💼 Vidhayak (MLA)", info.Vidhayak, info.VidhayakContact)}
    </div>
    <div class="card-footer">
      <span class="footer-label">Work Status</span>
      ${getStatusBadge(info.workStatus)}
    </div>
  `;

  return card;
}

// ── 7. Admin Panel Logic ─────────────────────────

/**
 * Initializes the homepage: sets up page switching, search,
 * edit/delete handlers, and realtime data listener.
 * @param {boolean} isAdmin - Current user admin status
 */
function initHomePage(isAdmin) {
  if (!dom.dataGrid) return;

  /** Switches between public, admin, and complaints views */
  window.switchPage = function switchPage(pageName) {
    if (pageName === "complaints") {
      if (!currentUser) {
        alert("Please login first to access Complaints.");
        window.location.href = LOGIN_PAGE;
        return;
      }
      window.open("../HTML_FILES/complaint.html", "_blank");
      return;
    }

    if (pageName === "admin") {
      if (!currentUser) {
        alert("Please login first.");
        window.location.href = LOGIN_PAGE;
        return;
      }
      if (!window.currentIsAdmin) {
        alert("Admin access required.");
        return;
      }
    }

    document
      .querySelectorAll(".page-section")
      .forEach((section) => section.classList.remove("active"));
    document
      .querySelectorAll(".nav-links button")
      .forEach((button) => button.classList.remove("active"));
    document.getElementById(`${pageName}-view`)?.classList.add("active");
    document.getElementById(`btn-${pageName}`)?.classList.add("active");
  };

  /** Loads area data into the admin form for editing */
  window.editData = async function editData(areaName) {
    try {
      const snapshot = await get(ref(db, `areas/${areaName}`));
      const info = snapshot.val();
      if (!info) return;

      window.switchPage("admin");

      const values = {
        area: areaName,
        je: info.JE || "",
        jeContact: info.JEContact || "",
        ee: info.EE || "",
        eeContact: info.EEContact || "",
        se: info.SE || "",
        seContact: info.SEContact || "",
        vidhayak: info.Vidhayak || "",
        vidhayakContact: info.VidhayakContact || "",
        "work-status": info.workStatus || "Pending",
        "work-details": info.workDetails || "",
        "map-url": info.mapUrl || "",
      };

      Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.value = value;
      });

      if (dom.mapPreviewContainer && dom.mapPreviewIframe) {
        if (info.mapUrl && isValidMapUrl(info.mapUrl)) {
          dom.mapPreviewIframe.src = info.mapUrl;
          dom.mapPreviewContainer.style.display = "block";
        } else {
          dom.mapPreviewContainer.style.display = "none";
          dom.mapPreviewIframe.src = "";
        }
      }

      document
        .getElementById("admin-view")
        ?.scrollIntoView({ behavior: "smooth" });
      document.querySelector(".btn-primary")?.replaceChildren();
      const submitBtn = document.querySelector(".btn-primary");
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-pen"></i> Update Area';
      }
    } catch (error) {
      alert(`Error loading area data: ${error.message}`);
    }
  };

  /** Saves or updates area data from the admin form */
  window.saveData = async function saveData() {
    if (!window.currentIsAdmin) {
      alert("You do not have permission to save data.");
      return;
    }

    const area = document.getElementById("area")?.value.trim();
    if (!area) {
      alert("Please enter an Area Name.");
      return;
    }

    const data = {
      JE: document.getElementById("je")?.value.trim() || "N/A",
      JEContact: document.getElementById("jeContact")?.value.trim() || "N/A",
      EE: document.getElementById("ee")?.value.trim() || "N/A",
      EEContact: document.getElementById("eeContact")?.value.trim() || "N/A",
      SE: document.getElementById("se")?.value.trim() || "N/A",
      SEContact: document.getElementById("seContact")?.value.trim() || "N/A",
      Vidhayak: document.getElementById("vidhayak")?.value.trim() || "N/A",
      VidhayakContact:
        document.getElementById("vidhayakContact")?.value.trim() || "N/A",
      workStatus: document.getElementById("work-status")?.value || "Pending",
      workDetails: document.getElementById("work-details")?.value.trim() || "",
      mapUrl: document.getElementById("map-url")?.value.trim() || "",
    };

    try {
      await set(ref(db, `areas/${area}`), data);
      alert("Data saved successfully!");
      clearForm();
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  };

  /** Deletes an area record after confirmation */
  window.deleteData = async function deleteData(areaName) {
    if (!window.currentIsAdmin) {
      alert("You do not have permission.");
      return;
    }

    if (!window.confirm(`Delete "${areaName}"?`)) {
      return;
    }

    try {
      await remove(ref(db, `areas/${areaName}`));
    } catch (error) {
      alert(`Delete Error: ${error.message}`);
    }
  };

  /** Toggles expand/collapse of engineer details in a card */
  window.toggleDetails = function toggleDetails(button) {
    const body = button.nextElementSibling;
    const isOpen = body?.classList.toggle("card-body-open");
    if (!body) return;
    button.innerHTML = isOpen
      ? '<i class="fas fa-chevron-up"></i> Hide Engineer Details'
      : '<i class="fas fa-chevron-down"></i> View Engineer Details';
  };

  /** Filters cards by area name based on search input */
  window.filterData = function filterData() {
    const query = dom.searchInput?.value.toLowerCase() || "";
    Array.from(document.getElementsByClassName("card")).forEach((card) => {
      const title = card.querySelector("h3")?.innerText.toLowerCase() || "";
      card.style.display = title.includes(query) ? "" : "none";
    });
  };

  /** Clears all admin form inputs and resets to default state */
  function clearForm() {
    [
      "area",
      "je",
      "jeContact",
      "ee",
      "eeContact",
      "se",
      "seContact",
      "vidhayak",
      "vidhayakContact",
      "work-details",
      "map-url",
    ].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.value = "";
    });

    const statusInput = document.getElementById("work-status");
    if (statusInput) statusInput.value = "Pending";
    if (dom.mapPreviewContainer) dom.mapPreviewContainer.style.display = "none";
    if (dom.mapPreviewIframe) dom.mapPreviewIframe.src = "";

    const submitBtn = document.querySelector(".btn-primary");
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save / Update Area';
    }
  }

  // Realtime listener for area data
  onValue(ref(db, "areas"), (snapshot) => {
    dom.dataGrid.innerHTML = "";
    const data = snapshot.val();

    if (!data) {
      dom.dataGrid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:40px;color:#777;">
          <i class="fas fa-inbox" style="font-size:4rem;margin-bottom:15px;opacity:0.5;"></i>
          <p>No areas registered yet.</p>
        </div>
      `;
      return;
    }

    Object.keys(data)
      .sort()
      .forEach((areaName) => {
        dom.dataGrid.appendChild(
          buildAreaCard(areaName, data[areaName], isAdmin),
        );
      });
  });

  // Auto-switch to admin view if URL param requested
  const requestedView = new URLSearchParams(window.location.search).get("view");
  if (requestedView === "admin" && window.currentIsAdmin) {
    window.setTimeout(() => window.switchPage("admin"), 0);
  }
}

// ── 8. Initialization ────────────────────────────

/**
 * Initializes the SmartGovWeb app after auth state is known.
 * @param {boolean} isAdmin - Whether current user is admin
 */
function initSmartGovApp(isAdmin) {
  window.isAdmin = isAdmin;
  window.currentIsAdmin = isAdmin;

  if (dom.adminButtonLink) {
    dom.adminButtonLink.style.display = isAdmin ? "" : "none";
  }
  if (dom.adminButton) {
    dom.adminButton.style.display = isAdmin ? "" : "none";
  }

  initHomePage(isAdmin);
}

/**
 * Checks if the given email is listed in the admins database node.
 * @param {string} email - User email to check
 */
async function checkAdminAndInit(email) {
  try {
    const snapshot = await get(ref(db, "admins"));
    const adminsData = snapshot.val() || {};
    const normalizedEmail = (email || "").trim().toLowerCase();
    const adminEmails = Object.values(adminsData)
      .map((value) => {
        if (typeof value === "string") return value.trim().toLowerCase();
        if (
          value &&
          typeof value === "object" &&
          typeof value.email === "string"
        ) {
          return value.email.trim().toLowerCase();
        }
        return "";
      })
      .filter(Boolean);

    initSmartGovApp(adminEmails.includes(normalizedEmail));
  } catch (error) {
    console.error("Admin role check failed:", error);
    initSmartGovApp(false);
  }
}

/** Publishes a custom event so child iframes know the app is ready */
function publishSiteReady() {
  window.smartGovShared = {
    auth,
    db,
    firebaseConfig,
    getCurrentUser: () => currentUser,
    getOrCreateUserKey,
  };

  window.dispatchEvent(
    new CustomEvent("smartgov:ready", {
      detail: {
        auth,
        db,
        firebaseConfig,
        currentUser,
        isAdmin: window.currentIsAdmin || false,
      },
    }),
  );
}

// ── Bootstrap ────────────────────────────────────
bindSharedUi();
hideLoadingWithFallback();

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  appInitialized = true;

  if (loadingFallbackTimer) {
    window.clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }

  if (user?.email) {
    localStorage.setItem("loggedEmail", user.email);
    await ensureUserRecord(user);
    await updateProfileDisplay(user);
  } else {
    localStorage.removeItem("loggedEmail");
    if (dom.profileInitials) dom.profileInitials.textContent = "?";
    if (dom.dropdownAvatar) dom.dropdownAvatar.textContent = "?";
    if (dom.dropdownName) dom.dropdownName.textContent = "Guest";
    if (dom.dropdownEmail) dom.dropdownEmail.textContent = "Please login";
  }

  revealPage();

  if (user?.email) {
    await checkAdminAndInit(user.email);
  } else {
    initSmartGovApp(false);
  }

  publishSiteReady();
});
