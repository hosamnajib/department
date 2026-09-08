// Application State
let currentTab = 'departments'; // 'departments' | 'supervisors'
let departments = [];
let supervisors = [];
let sortState = { key: 'id', asc: true };
let recordToDelete = null;

// Initial Default Data
const DEFAULT_SUPERVISORS = [
  { id: 'SUP-0007', firstName: 'Tauedea', lastName: 'Gabi', email: 'gabitautau@gmail.com', department: 'Software engineering', status: 'Active' },
  { id: 'SUP-0008', firstName: 'Krisha', lastName: 'Lama', email: 'krilam@gmail.com', department: 'Human Resources', status: 'Active' },
  { id: 'SUP-0003', firstName: 'Daniel', lastName: 'Lee', email: 'daniel.lee@example.com', department: 'Marketing', status: 'Active' },
  { id: 'SUP-0002', firstName: 'Aisyah', lastName: 'Rahman', email: 'aisyah.rahman@example.com', department: 'Software engineering', status: 'Active' },
  { id: 'SUP-0001', firstName: 'Wei Jie', lastName: 'Tan', email: 'weijie.tan@example.com', department: 'Business Data & Analysis', status: 'Active' }
];

const DEFAULT_DEPARTMENTS = [
  { id: 'DEP-0001', name: 'Software engineering', supervisorId: 'SUP-0007', status: 'Active' },
  { id: 'DEP-0002', name: 'Human Resources', supervisorId: 'SUP-0008', status: 'Active' },
  { id: 'DEP-0003', name: 'Marketing', supervisorId: 'SUP-0003', status: 'Active' },
  { id: 'DEP-0004', name: 'Business Data & Analysis', supervisorId: 'SUP-0001', status: 'Active' },
  { id: 'DEP-0005', name: 'Product & UX Design', supervisorId: 'SUP-0002', status: 'Active' }
];

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  const ready = await ensureAuth();
  if (!ready) return; // redirecting to the gateway sign-in page
  await loadData();
  populateDropdowns();
  renderCurrentTab();
});

// Send a write to the API. Unlike bare fetch(), this rejects on a non-2xx
// response and surfaces the server's error message, so callers never treat a
// failed save as success.
async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  if (res.status === 401) {
    window.location.replace('/auth/login');
    throw new Error('Session expired — signing in again.');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data && data.error && data.error.message) message = data.error.message;
    } catch (_) { /* non-JSON body */ }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// Gateway sign-in bootstrap (MICROAPP_AUTH.md).
// The gateway is the only place anyone signs in; if we have no live session,
// send the browser there. Fails open to local/offline mode if /auth/me is
// unreachable, or when the URL carries ?local=1.
async function ensureAuth() {
  if (location.search.includes('local=1')) return true;
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return true;
    const data = await res.json();
    if (data && data.authenticated === false) {
      window.location.replace('/auth/login');
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

// Data Persistence (MySQL API with localStorage fallback)
async function loadData(attempt = 0) {
  try {
    const [deptsRes, supsRes] = await Promise.all([
      fetch('/api/departments', { credentials: 'same-origin', cache: 'no-store' }),
      fetch('/api/supervisors', { credentials: 'same-origin', cache: 'no-store' })
    ]);

    if (deptsRes.status === 401 || supsRes.status === 401) {
      window.location.replace('/auth/login');
      return;
    }

    if (deptsRes.ok && supsRes.ok) {
      const depts = await deptsRes.json();
      const sups = await supsRes.json();
      departments = Array.isArray(depts) ? depts : [];
      supervisors = Array.isArray(sups) ? sups : [];
      saveDataLocal();
      populateDropdowns();
      renderCurrentTab();
      return;
    }

    // 503 etc. — the DB is briefly unavailable. Retry before falling back, and
    // do NOT overwrite what's on screen with seed data.
    if ((deptsRes.status >= 500 || supsRes.status >= 500) && attempt < 3) {
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      return loadData(attempt + 1);
    }
    console.warn(`API load failed (departments ${deptsRes.status}, supervisors ${supsRes.status}).`);
    if (attempt === 0 && (deptsRes.status >= 500 || supsRes.status >= 500)) {
      alert('The server could not reach the database. Showing the last loaded data — refresh in a moment.');
    }
    if (departments.length || supervisors.length) return; // keep current data
  } catch (e) {
    console.warn('API unreachable:', e);
    if (departments.length || supervisors.length) return;
  }

  // First load with nothing to show: fall back to localStorage / defaults.
  const savedDepts = localStorage.getItem('dept_app_departments');
  const savedSups = localStorage.getItem('dept_app_supervisors');

  departments = savedDepts ? JSON.parse(savedDepts) : [...DEFAULT_DEPARTMENTS];
  supervisors = savedSups ? JSON.parse(savedSups) : [...DEFAULT_SUPERVISORS];

  saveDataLocal();
  populateDropdowns();
  renderCurrentTab();
}

function saveDataLocal() {
  localStorage.setItem('dept_app_departments', JSON.stringify(departments));
  localStorage.setItem('dept_app_supervisors', JSON.stringify(supervisors));
}

// Helper: Auto ID Generators
function generateNextDeptId() {
  const nums = departments.map(d => {
    const match = d.id.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  });
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return `DEP-${String(maxNum + 1).padStart(4, '0')}`;
}

function generateNextSupId() {
  const nums = supervisors.map(s => {
    const match = s.id.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  });
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return `SUP-${String(maxNum + 1).padStart(4, '0')}`;
}

// Populate Dropdown Menus
function populateDropdowns() {
  // Filter Dropdown
  const filterSelect = document.getElementById('filter-1');
  if (currentTab === 'departments') {
    filterSelect.style.display = 'inline-block';
    filterSelect.innerHTML = '<option value="all">All supervisors</option>';
    supervisors.forEach(sup => {
      filterSelect.innerHTML += `<option value="${sup.id}">${sup.id} (${sup.firstName} ${sup.lastName})</option>`;
    });
  } else {
    filterSelect.style.display = 'none'; // No department column in supervisor table
  }

  // Department Form Supervisor Select (Referenced by ID)
  const deptSupSelect = document.getElementById('dept-supervisor');
  if (deptSupSelect) {
    deptSupSelect.innerHTML = '<option value="">Select a supervisor ID</option>';
    supervisors.forEach(sup => {
      deptSupSelect.innerHTML += `<option value="${sup.id}">${sup.id} - ${sup.firstName} ${sup.lastName}</option>`;
    });
  }
}

// Tab Switching
function switchTab(tabName) {
  currentTab = tabName;

  document.getElementById('tab-departments').classList.toggle('active', tabName === 'departments');
  document.getElementById('tab-supervisors').classList.toggle('active', tabName === 'supervisors');

  const pageTitle = document.getElementById('page-title');
  const addBtnText = document.getElementById('add-btn-text');
  const searchInput = document.getElementById('search-input');

  if (tabName === 'departments') {
    pageTitle.textContent = 'Departments';
    addBtnText.textContent = 'Add department';
    searchInput.placeholder = 'Search ID, name, supervisor...';
    document.getElementById('departments-table').style.display = 'table';
    document.getElementById('supervisors-table').style.display = 'none';
  } else {
    pageTitle.textContent = 'Supervisors Directory';
    addBtnText.textContent = 'Add supervisor';
    searchInput.placeholder = 'Search ID, first name, last name...';
    document.getElementById('departments-table').style.display = 'none';
    document.getElementById('supervisors-table').style.display = 'table';
  }

  populateDropdowns();
  renderCurrentTab();
}

// Helper: Get Supervisor Object by ID
function getSupervisorById(id) {
  return supervisors.find(s => s.id === id) || { id: '—', firstName: 'Unassigned', lastName: '', email: 'N/A' };
}

// Render Logic
function renderCurrentTab() {
  const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
  const filter1Val = document.getElementById('filter-1').value;
  const statusVal = document.getElementById('filter-status').value;

  if (currentTab === 'departments') {
    renderDepartments(searchQuery, filter1Val, statusVal);
  } else {
    renderSupervisors(searchQuery, filter1Val, statusVal);
  }
}

function renderDepartments(searchQuery, supervisorFilter, statusFilter) {
  const tbody = document.getElementById('departments-tbody');
  tbody.innerHTML = '';

  let filtered = departments.filter(dept => {
    const sup = getSupervisorById(dept.supervisorId);
    const supName = `${sup.firstName || ''} ${sup.lastName || ''}`.toLowerCase();

    // Search query match
    const matchesSearch = !searchQuery ||
      String(dept.id || '').toLowerCase().includes(searchQuery) ||
      String(dept.name || '').toLowerCase().includes(searchQuery) ||
      supName.includes(searchQuery);

    // Supervisor filter match
    const matchesSupervisor = supervisorFilter === 'all' || dept.supervisorId === supervisorFilter;

    // Status filter match
    const matchesStatus = statusFilter === 'all' || dept.status === statusFilter;

    return matchesSearch && matchesSupervisor && matchesStatus;
  });

  // Sort
  filtered.sort((a, b) => {
    let valA = a[sortState.key] || '';
    let valB = b[sortState.key] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortState.asc ? -1 : 1;
    if (valA > valB) return sortState.asc ? 1 : -1;
    return 0;
  });

  // Update counts
  document.getElementById('record-count').textContent = `${departments.length} records`;
  document.getElementById('shown-count').textContent = `${filtered.length} shown`;

  const emptyState = document.getElementById('empty-state');
  if (filtered.length === 0) {
    document.getElementById('departments-table').style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  document.getElementById('departments-table').style.display = 'table';
  emptyState.style.display = 'none';

  filtered.forEach(dept => {
    const sup = getSupervisorById(dept.supervisorId);
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="col-id">${dept.id}</td>
      <td>
        <div class="name-cell">
          <span class="name-title">${escapeHtml(dept.name)}</span>
          <span class="name-subtext">Department</span>
        </div>
      </td>
      <td>
        <div class="name-cell">
          <span class="badge badge-supervisor" style="width: fit-content; font-size:12px; margin-bottom: 3px;">${escapeHtml(sup.id)}</span>
          <span class="name-subtext" style="color: var(--text-primary); font-weight: 600;">${escapeHtml(sup.firstName + ' ' + sup.lastName)}</span>
        </div>
      </td>
      <td>
        <span class="badge ${dept.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${dept.status}</span>
      </td>
      <td style="text-align: right;">
        <div class="action-group" style="justify-content: flex-end;">
          <button class="btn-icon" onclick="editDepartment('${dept.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Edit
          </button>
          <button class="btn-icon danger" onclick="confirmDelete('department', '${dept.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSupervisors(searchQuery, deptFilter, statusFilter) {
  const tbody = document.getElementById('supervisors-tbody');
  tbody.innerHTML = '';

  let filtered = supervisors.filter(sup => {
    const fullName = `${sup.firstName || ''} ${sup.lastName || ''}`.toLowerCase();

    const matchesSearch = !searchQuery ||
      String(sup.id || '').toLowerCase().includes(searchQuery) ||
      fullName.includes(searchQuery) ||
      String(sup.email || '').toLowerCase().includes(searchQuery);

    const matchesStatus = statusFilter === 'all' || sup.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Sort. The supervisors table has no "name" column, so a sort picked on the
  // departments tab maps to firstName here instead of silently doing nothing.
  const sortKey = sortState.key === 'name' ? 'firstName' : sortState.key;
  filtered.sort((a, b) => {
    let valA = a[sortKey] || '';
    let valB = b[sortKey] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortState.asc ? -1 : 1;
    if (valA > valB) return sortState.asc ? 1 : -1;
    return 0;
  });

  document.getElementById('record-count').textContent = `${supervisors.length} records`;
  document.getElementById('shown-count').textContent = `${filtered.length} shown`;

  const emptyState = document.getElementById('empty-state');
  if (filtered.length === 0) {
    document.getElementById('supervisors-table').style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  document.getElementById('supervisors-table').style.display = 'table';
  emptyState.style.display = 'none';

  filtered.forEach(sup => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td class="col-id">${sup.id}</td>
      <td>
        <div class="name-cell">
          <span class="name-title">${escapeHtml(sup.firstName)}</span>
          <span class="name-subtext">${escapeHtml(sup.email)}</span>
        </div>
      </td>
      <td>
        <span style="font-weight: 600;">${escapeHtml(sup.lastName)}</span>
      </td>
      <td>
        <span class="badge ${sup.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${sup.status}</span>
      </td>
      <td style="text-align: right;">
        <div class="action-group" style="justify-content: flex-end;">
          <button class="btn-icon" onclick="editSupervisor('${sup.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Edit
          </button>
          <button class="btn-icon danger" onclick="confirmDelete('supervisor', '${sup.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Search and Filter Event Handlers
function handleSearch() {
  renderCurrentTab();
}

function handleFilter() {
  renderCurrentTab();
}

function sortTable(key) {
  if (sortState.key === key) {
    sortState.asc = !sortState.asc;
  } else {
    sortState.key = key;
    sortState.asc = true;
  }
  renderCurrentTab();
}

// Modal Handlers
function openModal(modalId) {
  populateDropdowns();
  document.getElementById(modalId).classList.add('open');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
}

function openAddModal() {
  if (currentTab === 'departments') {
    document.getElementById('dept-form-mode').value = 'add';
    document.getElementById('dept-modal-title').textContent = 'Add Department';
    document.getElementById('department-form').reset();
    
    // Auto-generate next DEP ID
    document.getElementById('dept-id').value = generateNextDeptId();
    
    openModal('department-modal');
  } else {
    document.getElementById('sup-form-mode').value = 'add';
    document.getElementById('sup-modal-title').textContent = 'Add Supervisor';
    document.getElementById('supervisor-form').reset();

    // Auto-generate next SUP ID
    document.getElementById('sup-id').value = generateNextSupId();

    openModal('supervisor-modal');
  }
}

// Save Department Action
async function saveDepartment(e) {
  e.preventDefault();

  const mode = document.getElementById('dept-form-mode').value;
  const oldId = document.getElementById('dept-form-id-old').value;

  let id = document.getElementById('dept-id').value.trim();
  const name = document.getElementById('dept-name').value.trim();
  const supervisorId = document.getElementById('dept-supervisor').value;
  const status = document.getElementById('dept-status').value;

  try {
    if (mode === 'add') {
      if (!id || departments.some(d => d.id === id)) id = generateNextDeptId();
      await apiSend('/api/departments', 'POST', { id, name, supervisorId, status });
    } else {
      await apiSend(`/api/departments/${encodeURIComponent(oldId)}`, 'PUT', { id: oldId, name, supervisorId, status });
    }
  } catch (err) {
    alert('Could not save department: ' + err.message);
    return; // leave the modal open so the user can correct and retry
  }

  await loadData(); // re-sync from the database, the source of truth
  closeModal('department-modal');
}

// Edit Department Action
function editDepartment(id) {
  const dept = departments.find(d => d.id === id);
  if (!dept) return;

  openModal('department-modal');

  document.getElementById('dept-form-mode').value = 'edit';
  document.getElementById('dept-form-id-old').value = id;
  document.getElementById('dept-modal-title').textContent = 'Edit Department';

  document.getElementById('dept-id').value = dept.id;
  document.getElementById('dept-name').value = dept.name;
  document.getElementById('dept-supervisor').value = dept.supervisorId || '';
  document.getElementById('dept-status').value = dept.status;
}

// Save Supervisor Action
async function saveSupervisor(e) {
  e.preventDefault();

  const mode = document.getElementById('sup-form-mode').value;
  const oldId = document.getElementById('sup-form-id-old').value;

  let id = document.getElementById('sup-id').value.trim();
  const firstName = document.getElementById('sup-firstname').value.trim();
  const lastName = document.getElementById('sup-lastname').value.trim();
  const email = document.getElementById('sup-email').value.trim();
  const status = document.getElementById('sup-status').value;

  try {
    if (mode === 'add') {
      if (!id || supervisors.some(s => s.id === id)) id = generateNextSupId();
      await apiSend('/api/supervisors', 'POST', { id, firstName, lastName, email, status });
    } else {
      await apiSend(`/api/supervisors/${encodeURIComponent(oldId)}`, 'PUT', { id: oldId, firstName, lastName, email, status });
    }
  } catch (err) {
    alert('Could not save supervisor: ' + err.message);
    return; // leave the modal open so the user can correct and retry
  }

  await loadData(); // re-sync from the database, the source of truth
  closeModal('supervisor-modal');
}

// Edit Supervisor Action
function editSupervisor(id) {
  const sup = supervisors.find(s => s.id === id);
  if (!sup) return;

  openModal('supervisor-modal');

  document.getElementById('sup-form-mode').value = 'edit';
  document.getElementById('sup-form-id-old').value = id;
  document.getElementById('sup-modal-title').textContent = 'Edit Supervisor';

  document.getElementById('sup-id').value = sup.id;
  document.getElementById('sup-firstname').value = sup.firstName;
  document.getElementById('sup-lastname').value = sup.lastName;
  document.getElementById('sup-email').value = sup.email;
  document.getElementById('sup-status').value = sup.status;
}

// Delete Confirmation Action
function confirmDelete(type, id) {
  recordToDelete = { type, id };
  const text = type === 'department' 
    ? `Are you sure you want to delete department "${id}"?`
    : `Are you sure you want to delete supervisor "${id}"?`;

  document.getElementById('delete-modal-text').textContent = text;
  
  const confirmBtn = document.getElementById('confirm-delete-btn');
  confirmBtn.onclick = () => {
    executeDelete();
    closeModal('delete-modal');
  };

  openModal('delete-modal');
}

async function executeDelete() {
  if (!recordToDelete) return;

  const { type, id } = recordToDelete;
  recordToDelete = null;

  try {
    const endpoint = type === 'department' ? '/api/departments/' : '/api/supervisors/';
    await apiSend(endpoint + encodeURIComponent(id), 'DELETE');
  } catch (err) {
    alert('Could not delete ' + type + ': ' + err.message);
    return;
  }

  await loadData(); // re-sync from the database, the source of truth
}

// Utility: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
