/**
 * ============================================================
 * complaint.js — SmartGovWeb Complaint Management System
 * ============================================================
 * Handles citizen complaint registration, image upload, status
 * tracking, admin/user mode switching, and EmailJS notifications.
 *
 * Sections:
 *   1. Firebase Config & State
 *   2. DOM Element References
 *   3. Utility Functions (escape, dates, IDs)
 *   4. Upload UI Helpers
 *   5. Complaint ID Generators
 *   6. Admin & User Management
 *   7. Email Notifications (EmailJS)
 *   8. Complaint CRUD Operations
 *   9. UI Rendering (table, modals, stats)
 *  10. Modal & Form Handlers
 *  11. Event Bindings & Initialization
 * ============================================================
 */

/** Firebase project configuration (shared across app) */
const firebaseConfig = {
  apiKey: "AIzaSyBejoCp3WwPnkYS8bdhf6A76UeHBTuSTqY",
  authDomain: "fir-contact-2ece7.firebaseapp.com",
  databaseURL: "https://fir-contact-2ece7-default-rtdb.firebaseio.com",
  projectId: "fir-contact-2ece7",
  storageBucket: "fir-contact-2ece7.firebasestorage.app",
  messagingSenderId: "694459518889",
  appId: "1:694459518889:web:c738883ad5627139affeb8",
};

// ── 1. Firebase Config & State ───────────────────
let db;              // Firebase Realtime Database instance
let storage;         // Firebase Storage instance
let auth;            // Firebase Auth instance
let firebaseDb;      // Database module namespace
let firebaseStorage; // Storage module namespace

/** In-memory complaint list synced from Firebase */
let complaints = [];
/** List of admin email addresses */
let admins = [];
/** Whether the current view is in admin mode */
let isAdminMode = false;
/** Email of the currently logged-in user */
let currentUserEmail = "";
/** Current Firebase auth user object */
let currentAuthUser = null;
/** Display name of the current user */
let currentUserName = "";
/** Active status filter: "all" | "pending" | "in-progress" | "resolved" */
let activeFilter = "all";
/** ID of complaint being edited, or null for new */
let editingComplaintId = null;
/** Selected image file for upload */
let selectedImageFile = null;

/** localStorage key for persisting admin/user mode */
const MODE_STORAGE_KEY = "complaintsAdminMode";

/** EmailJS configuration for resolution notifications */
const EMAIL_CONFIG = {
  publicKey: "C7l8-x95L8FQAIyHz",
  serviceId: "service_hnqa3y9",
  templateId: "template_ceo846b",
};

// ── 2. DOM Element References ────────────────────
const elements = {
  totalComplaints: document.getElementById("totalComplaints"),
  pendingComplaints: document.getElementById("pendingComplaints"),
  resolvedComplaints: document.getElementById("resolvedComplaints"),
  complaintsList: document.getElementById("complaintsList"),
  modeToggle: document.getElementById("modeToggle"),
  modeText: document.getElementById("modeText"),
  complaintModal: document.getElementById("complaintModal"),
  complaintModalTitle: document.getElementById("complaintModalTitle"),
  complaintForm: document.getElementById("complaintForm"),
  successModal: document.getElementById("successModal"),
  successMessage: document.getElementById("successMessage"),
  submitComplaintBtn: document.getElementById("submitComplaintBtn"),
  problemPhoto: document.getElementById("problemPhoto"),
  photoPreview: document.getElementById("photoPreview"),
  uploadStatus: document.getElementById("uploadStatus"),
  uploadProgressWrap: document.getElementById("uploadProgressWrap"),
  uploadProgressFill: document.getElementById("uploadProgressFill"),
  uploadProgressText: document.getElementById("uploadProgressText"),
  detailModal: document.getElementById("detailModal"),
  detailContent: document.getElementById("detailContent"),
};

// ── 3. Utility Functions ─────────────────────────

/** Escapes HTML special characters to prevent XSS */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&#39;");
}

/** Normalizes email for consistent comparison */
function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/** Formats a timestamp value into a readable date string */
function getDisplayDate(value) {
  if (!value) return "Just now";
  if (typeof value === "object") return "Saving...";
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-IN");
}

// ── 4. Upload UI Helpers ─────────────────────────

/** Resets the photo upload UI to default state */
function resetUploadUi() {
  if (elements.photoPreview) elements.photoPreview.innerHTML = "";
  if (elements.uploadStatus) {
    elements.uploadStatus.classList.remove("hidden");
    elements.uploadStatus.textContent = "Image upload is optional.";
  }
  if (elements.uploadProgressWrap)
    elements.uploadProgressWrap.classList.add("hidden");
  if (elements.uploadProgressFill)
    elements.uploadProgressFill.style.width = "0%";
  if (elements.uploadProgressText)
    elements.uploadProgressText.textContent = "0%";
}

/** Updates the upload progress bar and status text */
function showUploadProgress(percent, message) {
  if (elements.uploadProgressWrap)
    elements.uploadProgressWrap.classList.remove("hidden");
  if (elements.uploadProgressFill)
    elements.uploadProgressFill.style.width = `${percent}%`;
  if (elements.uploadProgressText)
    elements.uploadProgressText.textContent = `${percent}%`;
  if (elements.uploadStatus) {
    elements.uploadStatus.classList.remove("hidden");
    elements.uploadStatus.textContent = message;
  }
}

// ── 5. Complaint ID Generators ───────────────────

/** Returns the next global complaint number across all users */
function getNextGlobalComplaintNumber() {
  return (
    complaints.reduce((maxNumber, complaint) => {
      const parsedNumber = Number(complaint.globalComplaintNumber);
      return Number.isFinite(parsedNumber)
        ? Math.max(maxNumber, parsedNumber)
        : maxNumber;
    }, 0) + 1
  );
}

/** Returns the next sequential complaint key (e.g., "complaint_5") */
function getNextComplaintKey() {
  const nextNumber =
    complaints.reduce((maxNumber, complaint) => {
      const keyMatch = /^complaint_(\d+)$/i.exec(
        String(complaint.id || "").trim(),
      );
      if (keyMatch) {
        return Math.max(maxNumber, Number(keyMatch[1]) || 0);
      }

      const storedNumber = Number(complaint.globalComplaintNumber);
      return Number.isFinite(storedNumber)
        ? Math.max(maxNumber, storedNumber)
        : maxNumber;
    }, 0) + 1;

  return `complaint_${nextNumber}`;
}

/** Returns the next complaint number for a specific user */
function getNextUserComplaintNumber(userEmail) {
  const normalizedUserEmail = normalizeEmail(userEmail);

  return (
    complaints.reduce((maxNumber, complaint) => {
      if (normalizeEmail(complaint.userEmail) !== normalizedUserEmail) {
        return maxNumber;
      }

      const parsedNumber = Number(complaint.userComplaintNumber);
      if (Number.isFinite(parsedNumber)) {
        return Math.max(maxNumber, parsedNumber);
      }

      const legacyMatch = /^complaint\s+(\d+)$/i.exec(
        String(complaint.complaintId || "").trim(),
      );
      if (!legacyMatch) return maxNumber;
      return Math.max(maxNumber, Number(legacyMatch[1]) || 0);
    }, 0) + 1
  );
}

/** Generates a display ID like "complaint 3" based on list position */
function getComplaintDisplayId(complaint, listLength, index) {
  const complaintNumber = Math.max(listLength - index, 1);
  return `complaint ${complaintNumber}`;
}

// ── 6. Admin & User Management ───────────────────

/** Loads admin emails from the "admins" database node */
async function loadAdmins() {
  const snapshot = await firebaseDb.get(firebaseDb.ref(db, "admins"));
  const data = snapshot.val() || {};
  admins = Object.values(data)
    .map((value) => {
      if (typeof value === "string") return value.trim().toLowerCase();
      if (value?.email) return String(value.email).trim().toLowerCase();
      return "";
    })
    .filter(Boolean);
}

/** Fetches the current user's display name from the database */
async function loadCurrentUserName() {
  const email = normalizeEmail(currentAuthUser?.email || currentUserEmail);
  if (!db || !email) {
    currentUserName = "";
    return "";
  }

  try {
    const snapshot = await firebaseDb.get(firebaseDb.ref(db, "users"));
    const users = snapshot.val() || {};
    const match = Object.values(users).find(
      (user) =>
        String(user?.email || "")
          .trim()
          .toLowerCase() === email,
    );
    currentUserName = String(match?.officialName || "").trim();
    return currentUserName;
  } catch (error) {
    console.error("Unable to load user name:", error);
    currentUserName = "";
    return "";
  }
}

/** Determines admin status and sets up the UI accordingly */
function checkAdminStatus() {
  const email = normalizeEmail(
    currentAuthUser?.email || localStorage.getItem("loggedEmail"),
  );
  currentUserEmail = email || "anonymous@guest.com";
  const canAdmin = admins.includes(email);
  const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
  isAdminMode = canAdmin && savedMode !== "user";
  syncModeUi();

  displayComplaints(getFilteredComplaints());
}

/** Updates the mode toggle button visibility and text */
function syncModeUi() {
  if (elements.modeToggle) {
    elements.modeToggle.style.display = admins.includes(currentUserEmail)
      ? "flex"
      : "none";
  }

  if (elements.modeText) {
    elements.modeText.textContent = isAdminMode ? "Admin Mode" : "User Mode";
  }
}

/** Returns complaints filtered by user and status */
function getFilteredComplaints() {
  let filtered = [...complaints];

  if (!isAdminMode) {
    filtered = filtered.filter(
      (complaint) => normalizeEmail(complaint.userEmail) === currentUserEmail,
    );
  }

  if (activeFilter !== "all") {
    filtered = filtered.filter(
      (complaint) => complaint.status === activeFilter,
    );
  }

  return filtered;
}

/** Updates the stat card numbers */
function updateStats() {
  const visible = !isAdminMode
    ? complaints.filter(
        (complaint) => normalizeEmail(complaint.userEmail) === currentUserEmail,
      )
    : complaints;

  const pendingCount = visible.filter(
    (complaint) => complaint.status === "pending",
  ).length;
  const resolvedCount = visible.filter(
    (complaint) => complaint.status === "resolved",
  ).length;

  if (elements.totalComplaints)
    elements.totalComplaints.textContent = String(visible.length);
  if (elements.pendingComplaints)
    elements.pendingComplaints.textContent = String(pendingCount);
  if (elements.resolvedComplaints)
    elements.resolvedComplaints.textContent = String(resolvedCount);
}

// ── 7. Email Notifications ───────────────────────

/** Sends a resolution email via EmailJS when a complaint is resolved */
async function sendResolutionEmail(complaint) {
  const emailConfig = window.emailJsConfig || EMAIL_CONFIG;
  const recipientEmail = String(complaint.userEmail || "").trim();
  if (
    !window.emailjs ||
    !emailConfig.publicKey ||
    !emailConfig.serviceId ||
    !emailConfig.templateId ||
    !recipientEmail
  ) {
    return false;
  }

  const complaintTitle = complaint.title || complaint.workType || "Complaint";
  const recipientName =
    String(complaint.userName || "").trim() || recipientEmail.split("@")[0];
  const resolvedDate = new Date().toLocaleString("en-IN");
  const templateParams = {
    name: recipientName,
    email: recipientEmail,
    complaint_id: complaint.complaintId || complaint.id || "N/A",
    title: complaintTitle,
    resolved_date: resolvedDate,
  };

  try {
    await window.emailjs.send(
      emailConfig.serviceId,
      emailConfig.templateId,
      templateParams,
      { publicKey: emailConfig.publicKey },
    );
    return true;
  } catch (error) {
    console.error("Resolution email failed:", {
      status: error?.status || null,
      text: error?.text || error?.message || "Unknown EmailJS error",
      recipientEmail,
      templateParams,
    });
    return false;
  }
}

// ── 8. Complaint CRUD Operations ─────────────────

/** Uploads an image to Firebase Storage and returns the download URL */
async function uploadComplaintImage(file, complaintId) {
  if (!file) return "";

  const fileRef = firebaseStorage.ref(
    storage,
    `complaints/${complaintId}-${Date.now()}-${file.name.replace(/\s+/g, "_")}`,
  );

  showUploadProgress(15, "Uploading image...");
  await firebaseStorage.uploadBytes(fileRef, file);
  showUploadProgress(85, "Finalizing upload...");
  const imageUrl = await firebaseStorage.getDownloadURL(fileRef);
  showUploadProgress(100, "Upload complete");
  return imageUrl;
}

/** Handles form submission for new or edited complaints */
async function handleComplaintSubmit(event) {
  event.preventDefault();
  if (!db) return;

  const payload = {
    workType: document.getElementById("workType")?.value || "",
    title: document.getElementById("title")?.value.trim() || "",
    phone: document.getElementById("phone")?.value.trim() || "",
    address: document.getElementById("address")?.value.trim() || "",
    description: document.getElementById("description")?.value.trim() || "",
  };

  if (
    !payload.workType ||
    !payload.title ||
    !payload.phone ||
    !payload.address ||
    !payload.description
  ) {
    alert("Please complete all required complaint fields.");
    return;
  }

  try {
    if (elements.submitComplaintBtn) {
      elements.submitComplaintBtn.disabled = true;
      elements.submitComplaintBtn.textContent = editingComplaintId
        ? "Updating..."
        : "Submitting...";
    }

    let complaintId = editingComplaintId;
    let dbRef;
    let existing = null;
    const normalizedUserEmail = normalizeEmail(currentUserEmail);

    if (editingComplaintId) {
      existing =
        complaints.find((item) => item.id === editingComplaintId) || null;
      dbRef = firebaseDb.ref(db, `complaints/${editingComplaintId}`);
    } else {
      complaintId = getNextComplaintKey();
      dbRef = firebaseDb.ref(db, `complaints/${complaintId}`);
    }

    let imageUrl = existing?.imageUrl || "";
    if (selectedImageFile) {
      imageUrl = await uploadComplaintImage(selectedImageFile, complaintId);
    }

    const userComplaintNumber =
      existing?.userComplaintNumber ||
      getNextUserComplaintNumber(normalizedUserEmail);
    const globalComplaintNumber =
      existing?.globalComplaintNumber || getNextGlobalComplaintNumber();

    const complaintRecord = {
      complaintId: existing?.complaintId || `complaint ${userComplaintNumber}`,
      globalComplaintNumber,
      userComplaintNumber,
      ...payload,
      userName:
        existing?.userName ||
        currentUserName ||
        currentUserEmail.split("@")[0] ||
        "User",
      imageUrl,
      status: existing?.status || "pending",
      userEmail: normalizedUserEmail,
      createdAt: existing?.createdAt || Date.now(),
      registeredAt: existing?.registeredAt || firebaseDb.serverTimestamp(),
      updatedAt: Date.now(),
    };

    await firebaseDb.set(dbRef, complaintRecord);
    closeComplaintModal();
    showSuccess(
      editingComplaintId
        ? "Complaint updated successfully!"
        : "Complaint registered successfully!",
    );
  } catch (error) {
    console.error("Complaint submit failed:", error);
    alert(`Unable to save complaint: ${error.message}`);
  } finally {
    if (elements.submitComplaintBtn) {
      elements.submitComplaintBtn.disabled = false;
      elements.submitComplaintBtn.textContent = editingComplaintId
        ? "Update Complaint"
        : "Submit Complaint";
    }
    selectedImageFile = null;
  }
}

/** Deletes a complaint after confirmation */
async function deleteComplaint(id) {
  const complaint = complaints.find((item) => item.id === id);
  if (!complaint) return;

  if (
    !isAdminMode &&
    normalizeEmail(complaint.userEmail) !== currentUserEmail
  ) {
    alert("You can only delete your own complaints.");
    return;
  }

  if (!window.confirm("Delete this complaint?")) {
    return;
  }

  try {
    await firebaseDb.remove(firebaseDb.ref(db, `complaints/${id}`));
  } catch (error) {
    console.error("Complaint delete failed:", error);
    alert(`Unable to delete complaint: ${error.message}`);
  }
}

/** Updates complaint status and sends resolution email if resolved */
async function updateStatus(id, status) {
  if (!isAdminMode) {
    alert("Admin access required.");
    return;
  }

  const complaint = complaints.find((item) => item.id === id);
  if (!complaint) return;

  try {
    const updates = {
      status,
      updatedAt: Date.now(),
    };

    if (status === "resolved" && complaint.status !== "resolved") {
      updates.resolvedAt = firebaseDb.serverTimestamp();
    }

    await firebaseDb.update(firebaseDb.ref(db, `complaints/${id}`), updates);

    if (status === "resolved" && complaint.status !== "resolved") {
      const sent = await sendResolutionEmail(complaint);
      if (sent) {
        await firebaseDb.update(firebaseDb.ref(db, `complaints/${id}`), {
          resolutionEmailSentAt: firebaseDb.serverTimestamp(),
        });
        alert(`Complaint resolved and email sent to ${complaint.userEmail}`);
      } else {
        alert(
          `Complaint resolved, but email notification failed for ${complaint.userEmail}.`,
        );
      }
    }
  } catch (error) {
    console.error("Complaint status update failed:", error);
    alert(`Unable to update status: ${error.message}`);
  }
}

// ── 9. UI Rendering ──────────────────────────────

/** Renders the empty state message */
function renderEmptyState() {
  if (!elements.complaintsList) return;

  elements.complaintsList.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-inbox"></i>
      <h3>No complaints found</h3>
      <p>${isAdminMode ? "No complaint records are available yet." : 'Click "New Complaint" to register your first complaint.'}</p>
    </div>
  `;
}

/** Returns action buttons HTML based on admin/user mode */
function complaintActions(complaint) {
  if (isAdminMode) {
    return `
      <div class="actions">
        <button class="table-btn resolve" title="Edit" onclick="openComplaintEditor('${complaint.id}')">
          <i class="fas fa-pen"></i>
        </button>
        <select class="status-select" onchange="updateStatus('${complaint.id}', this.value)">
          <option value="pending" ${complaint.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="in-progress" ${complaint.status === "in-progress" ? "selected" : ""}>In Progress</option>
          <option value="resolved" ${complaint.status === "resolved" ? "selected" : ""}>Resolved</option>
        </select>
        <button class="table-btn delete" title="Delete" onclick="deleteComplaint('${complaint.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
  }

  return `
    <div class="actions">
      <button class="table-btn delete" title="Delete" onclick="deleteComplaint('${complaint.id}')">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `;
}

/** Renders the complaints table */
function displayComplaints(list) {
  if (!elements.complaintsList) return;

  updateStats();

  if (!list.length) {
    renderEmptyState();
    return;
  }

  elements.complaintsList.innerHTML = `
    <table class="complaints-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Type</th>
          ${isAdminMode ? "<th>User</th>" : ""}
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map(
            (complaint, index) => `
          <tr class="table-row">
            <td>
              <span class="complaint-link" onclick="showComplaintDetails('${complaint.id}')">${escapeHtml(getComplaintDisplayId(complaint, list.length, index))}</span>
            </td>
            <td>${escapeHtml(complaint.title || "Complaint")}</td>
            <td>${escapeHtml(complaint.workType || "General")}</td>
            ${isAdminMode ? `<td>${escapeHtml(complaint.userEmail || "Unknown")}</td>` : ""}
            <td>
              <span class="status-badge status-${escapeHtml(complaint.status || "pending")}">
                ${escapeHtml(complaint.status || "pending")}
              </span>
            </td>
            <td>${escapeHtml(getDisplayDate(complaint.registeredAt || complaint.createdAt))}</td>
            <td>${complaintActions(complaint)}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

/** Shows complaint details in a modal */
function showComplaintDetails(id) {
  const complaint = complaints.find((item) => item.id === id);
  if (!complaint) return;

  const content = `
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Complaint ID</strong>
      <span>${escapeHtml(complaint.complaintId || complaint.id)}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Title</strong>
      <span>${escapeHtml(complaint.title || "Complaint")}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Type</strong>
      <span>${escapeHtml(complaint.workType || "General")}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Status</strong>
      <span class="status-badge status-${escapeHtml(complaint.status || "pending")}">${escapeHtml(complaint.status || "pending")}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Phone</strong>
      <span>${escapeHtml(complaint.phone || "N/A")}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Address</strong>
      <span>${escapeHtml(complaint.address || "N/A")}</span>
    </div>
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Description</strong>
      <p style="line-height: 1.6;">${escapeHtml(complaint.description || "No description")}</p>
    </div>
    ${
      complaint.imageUrl
        ? `
    <div style="margin-bottom: 16px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 8px;">Attached Image</strong>
      <img src="${escapeHtml(complaint.imageUrl)}" style="max-width: 100%; border-radius: 8px; border: 1px solid #ddd;" alt="Complaint image">
    </div>
    `
        : ""
    }
    <div style="margin-bottom: 8px;">
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Registered By</strong>
      <span>${escapeHtml(complaint.userEmail || "Unknown")}</span>
    </div>
    <div>
      <strong style="color: var(--primary); display: block; margin-bottom: 4px;">Date</strong>
      <span>${escapeHtml(getDisplayDate(complaint.registeredAt || complaint.createdAt))}</span>
    </div>
  `;

  if (elements.detailContent) elements.detailContent.innerHTML = content;
  if (elements.detailModal) elements.detailModal.style.display = "block";
}

/** Closes the detail modal */
function closeDetailModal() {
  if (elements.detailModal) elements.detailModal.style.display = "none";
}

// ── 10. Modal & Form Handlers ────────────────────

/** Opens the new complaint modal */
function openComplaintModal() {
  editingComplaintId = null;
  selectedImageFile = null;
  if (elements.complaintForm) elements.complaintForm.reset();
  if (elements.complaintModalTitle) {
    elements.complaintModalTitle.innerHTML =
      '<i class="fas fa-plus-circle"></i> Register Complaint';
  }
  if (elements.submitComplaintBtn) {
    elements.submitComplaintBtn.textContent = "Submit Complaint";
  }
  resetUploadUi();
  if (elements.complaintModal) {
    elements.complaintModal.style.display = "block";
  }
}

/** Closes the complaint modal */
function closeComplaintModal() {
  if (elements.complaintModal) {
    elements.complaintModal.style.display = "none";
  }
}

/** Closes the success modal */
function closeSuccessModal() {
  if (elements.successModal) elements.successModal.style.display = "none";
}

/** Shows the success modal with a message */
function showSuccess(message) {
  if (elements.successMessage) elements.successMessage.textContent = message;
  if (elements.successModal) elements.successModal.style.display = "flex";
}

/** Initializes photo preview and file selection handling */
function initPhotoPreview() {
  resetUploadUi();

  elements.problemPhoto?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    selectedImageFile = file || null;

    if (!file || !elements.photoPreview) {
      resetUploadUi();
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      elements.photoPreview.innerHTML = `<img src="${escapeHtml(loadEvent.target?.result || "")}" alt="Preview">`;
      if (elements.uploadStatus) {
        elements.uploadStatus.classList.remove("hidden");
        elements.uploadStatus.textContent =
          "Image selected and ready to upload.";
      }
      if (elements.uploadProgressWrap)
        elements.uploadProgressWrap.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  });
}

/** Filters complaints by status */
function filterComplaints(status) {
  activeFilter = status;
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === status);
  });
  displayComplaints(getFilteredComplaints());
}

/** Toggles between admin and user mode */
function toggleMode() {
  if (!admins.includes(currentUserEmail)) {
    return;
  }

  isAdminMode = !isAdminMode;
  localStorage.setItem(MODE_STORAGE_KEY, isAdminMode ? "admin" : "user");
  syncModeUi();
  displayComplaints(getFilteredComplaints());
}

/** Opens the complaint editor modal with existing data */
function openComplaintEditor(id) {
  const complaint = complaints.find((item) => item.id === id);
  if (!complaint) return;

  if (
    normalizeEmail(complaint.userEmail) !== currentUserEmail &&
    !isAdminMode
  ) {
    alert("You can only edit your own complaints.");
    return;
  }

  editingComplaintId = id;
  selectedImageFile = null;

  document.getElementById("workType").value = complaint.workType || "";
  document.getElementById("title").value = complaint.title || "";
  document.getElementById("phone").value = complaint.phone || "";
  document.getElementById("address").value = complaint.address || "";
  document.getElementById("description").value = complaint.description || "";
  if (elements.problemPhoto) elements.problemPhoto.value = "";
  if (elements.complaintModalTitle) {
    elements.complaintModalTitle.innerHTML =
      '<i class="fas fa-pen"></i> Edit Complaint';
  }
  if (elements.submitComplaintBtn) {
    elements.submitComplaintBtn.textContent = "Update Complaint";
  }
  if (elements.photoPreview) {
    elements.photoPreview.innerHTML = complaint.imageUrl
      ? `<img src="${escapeHtml(complaint.imageUrl)}" alt="Complaint image">`
      : "";
  }
  if (elements.uploadStatus) {
    elements.uploadStatus.classList.remove("hidden");
    elements.uploadStatus.textContent = complaint.imageUrl
      ? "Existing image will be kept unless you choose a new one."
      : "No image attached. You can still submit without one.";
  }
  if (elements.uploadProgressWrap)
    elements.uploadProgressWrap.classList.add("hidden");

  if (elements.complaintModal) {
    elements.complaintModal.style.display = "block";
  }
}

// ── 11. Event Bindings & Initialization ──────────

/** Sets up realtime listener for complaints data */
function loadComplaints() {
  firebaseDb.onValue(firebaseDb.ref(db, "complaints"), (snapshot) => {
    const data = snapshot.val() || {};
    complaints = Object.entries(data)
      .map(([id, value]) => ({ id, ...value }))
      .sort(
        (a, b) =>
          (b.registeredAt || b.createdAt || 0) -
          (a.registeredAt || a.createdAt || 0),
      );
    displayComplaints(getFilteredComplaints());
  });
}

/** Attaches form and window event listeners */
function bindEvents() {
  elements.complaintForm?.addEventListener("submit", handleComplaintSubmit);
}

/** Initializes Firebase, auth, and loads initial data */
async function initFirebase() {
  const [{ initializeApp }, authModule, databaseModule, storageModule] =
    await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js"),
    ]);

  firebaseDb = databaseModule;
  firebaseStorage = storageModule;

  const app = initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = databaseModule.getDatabase(app);
  storage = storageModule.getStorage(app);

  authModule.onAuthStateChanged(auth, async (user) => {
    currentAuthUser = user;
    if (!user) {
      try {
        await authModule.signInAnonymously(auth);
      } catch (error) {
        console.warn("Anonymous auth unavailable:", error);
      }
      currentUserEmail =
        localStorage.getItem("loggedEmail") || "anonymous@guest.com";
    } else {
      currentUserEmail =
        user.email ||
        localStorage.getItem("loggedEmail") ||
        "anonymous@guest.com";
    }

    localStorage.setItem("loggedEmail", currentUserEmail);
    await loadCurrentUserName();
    await loadAdmins();
    checkAdminStatus();
  });

  currentUserEmail =
    localStorage.getItem("loggedEmail") || "anonymous@guest.com";
  await loadAdmins();
  bindEvents();
  initPhotoPreview();
  checkAdminStatus();
  loadComplaints();
}

// Expose functions to global scope for inline HTML onclick handlers
window.openComplaintModal = openComplaintModal;
window.closeComplaintModal = closeComplaintModal;
window.closeSuccessModal = closeSuccessModal;
window.toggleMode = toggleMode;
window.filterComplaints = filterComplaints;
window.updateStatus = updateStatus;
window.deleteComplaint = deleteComplaint;
window.openComplaintEditor = openComplaintEditor;
window.showComplaintDetails = showComplaintDetails;
window.closeDetailModal = closeDetailModal;

// Close modals when clicking outside
window.addEventListener("click", (event) => {
  if (event.target === elements.complaintModal) closeComplaintModal();
  if (event.target === elements.successModal) closeSuccessModal();
  if (event.target === elements.detailModal) closeDetailModal();
});

// Initialize Firebase and the complaint system
initFirebase().catch((error) => {
  console.error("Failed to initialize complaint system:", error);
});
