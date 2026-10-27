"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { auth, subscribeToAuthUser } from "./lib/firebase";
import { crmRequest } from "./lib/crm-data";
import { isRoleBelow, reportableRoles } from "./lib/roles";
import BrandLogo from "./brand-logo";

const navItems = [
  ["Overview", "grid"], ["Clients", "users"], ["Employees", "briefcase"], ["Services", "layers"], ["Payments", "wallet"], ["Reports", "chart"], ["Excel records", "file"],
];

// How long a fetched record set stays fresh. Switching between Overview and
// Clients, or re-opening a tab, no longer re-reads collections that were just
// loaded; an edit forces an immediate re-read instead (see refreshRecords).
const RECORD_CACHE_MS = 45000;
// Rendering every row of a large client table (14 columns each) is what makes
// the UI itself feel slow, so tables paint this many rows and load the rest on
// demand. Exports and search still run against the full record set.
const TABLE_PAGE_SIZE = 50;

// Firestore reads each view needs. "Overview" and "Clients" render the same
// client list, so both reuse the cached clients read instead of paying for the
// network again on every tab switch.
const sectionDataPlan = {
  Overview: ["clients", "employees"],
  Clients: ["clients"],
  Employees: ["employees"],
  Services: ["services"],
  Payments: ["payments"],
  Reports: ["clients", "payments"],
  "Excel records": ["clients"],
};

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v3h4v-3" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    wallet: <><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6" /><path d="M16 14h.01" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m7 16 4-5 3 2 5-7" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatMoney(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Work done between 10 AM and 5 PM counts as "Morning"; anything after 5 PM counts as "Night".
function workShiftFromTime(workTime) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(workTime || "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return "";
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 10 * 60 && totalMinutes < 17 * 60 ? "Morning" : "Night";
}

function workShiftLabel(client) {
  const shift = client?.workShift || workShiftFromTime(client?.workTime);
  return shift || "";
}

// "Assigned at" is the day/night shift a Social Media user selects when adding a
// client. Stored lowercase; exported as a title-cased label.
function assignedAtLabel(client) {
  const value = String(client?.assignedShift || "").trim().toLowerCase();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function DateCell({ date, client }) {
  const shift = workShiftLabel(client);
  return <div className="date-stack"><span>{date || "-"}</span>{shift && <small className={`shift-tag ${shift.toLowerCase()}`}><i />{shift}</small>}</div>;
}

function limitDigits(value, length) {
  return String(value).replace(/\D/g, "").slice(0, length);
}

function ClientRowActions({ client, canManage, onViewClient, onEditClient, onDeleteClient }) {
  return <div className="client-row-actions">
    <button type="button" className="text-button client-view-button" title="View client details" onClick={() => onViewClient(client)}><Icon name="arrow" size={14} /></button>
    {canManage && <>
      <button type="button" className="text-button" onClick={() => onEditClient(client)}>Edit</button>
      <button type="button" className="client-delete-button" onClick={() => onDeleteClient(client)}>Delete</button>
    </>}
  </div>;
}

// Popup that shows every stored field of one client record.
function ClientDetailsModal({ client, onClose }) {
  if (!client) return null;
  const pending = Math.max(client.amount - client.received, 0);
  const personalRows = [
    ["Cell", client.cell], ["CNIC", client.cnic], ["PIN", client.pin],
    ["Password", client.password], ["Email", client.email], ["Date", client.date],
  ];
  const workRows = [
    ["Provider", client.provider], ["Work time", client.workTime || workShiftLabel(client) || "-"], ["Assigned at", assignedAtLabel(client) || "-"],
    ["Assigned to", client.owner || "-"], ["Assigned by", client.assignedByName || "-"], ["Total amount", formatMoney(client.amount), "money"], ["Received", formatMoney(client.received), "money positive"],
    ["Pending", formatMoney(pending), pending > 0 ? "money pending" : "money positive"],
  ];
  const documents = clientDocuments(client);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-card client-details-card" role="dialog" aria-modal="true" aria-labelledby="client-details-title">
      <div className="modal-header">
        <div className="client-details-avatar-row">
          <div className={`client-avatar ${client.color}`}>{client.initials || client.name?.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "?"}</div>
          <div className="meta"><strong id="client-details-title">{client.name}</strong><span>{client.id}</span></div>
          <div className="client-details-badges">
            <span className={`status-badge ${String(client.status || "active").toLowerCase().replace(" ", "-")}`}><i />{client.status || "Active"}</span>
            <span className={`payment-badge ${String(client.payment || "pending").toLowerCase()}`}>{client.payment || "Pending"}</span>
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="Close dialog">&times;</button>
      </div>
      <div className="client-details-body">
        <div className="client-details-section">
          <strong>Personal details</strong>
          <dl className="client-details-grid">
            {personalRows.map(([label, value]) => <div key={label} className="client-details-item"><dt>{label}</dt><dd>{value ? String(value) : "-"}</dd></div>)}
          </dl>
        </div>
        <div className="client-details-section">
          <strong>Work & payment</strong>
          <dl className="client-details-grid">
            {workRows.map(([label, value, tone]) => <div key={label} className="client-details-item"><dt>{label}</dt><dd className={tone}>{value ? String(value) : "-"}</dd></div>)}
            {client.work && client.work !== client.provider ? <div className="client-details-item wide"><dt>Work</dt><dd>{client.work}</dd></div> : null}
            {client.description ? <div className="client-details-item wide"><dt>Description</dt><dd>{client.description}</dd></div> : null}
          </dl>
        </div>
        <div className="client-details-section">
          <strong>Documents</strong>
          {documents.length ? <ul className="document-list">{documents.map((document, index) => <li key={`${document.name}-${index}`}><DocumentLinkItem document={document} /></li>)}</ul> : <div className="client-details-empty"><dd className="document-empty">No documents uploaded</dd></div>}
        </div>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
    </div>
  </div>;
}

function DocumentLinkItem({ document }) {
  return <button
    type="button"
    className="document-link"
    title={document.name || "Open document"}
    onClick={() => openDocumentInNewTab(document)}
  >
    <Icon name="file" size={14} />
    <span className="document-link-name">{document.name || "Document"}</span>
  </button>;
}

function clientDocuments(client) {
  // `url` is a Cloud Storage download URL (the current shape); `dataUrl` is the
  // older inlined base64 payload, still present on records saved before the
  // upload moved to Storage.
  const stored = Array.isArray(client?.documents)
    ? client.documents.filter((item) => item && (item.url || item.dataUrl))
    : [];
  if (stored.length) return stored;
  // Legacy records carry a single document in the flat fields.
  if (client?.document) {
    return [{
      name: client.documentName || "Document",
      type: client.documentType || "application/octet-stream",
      dataUrl: client.document,
    }];
  }
  return [];
}

function DocumentLink({ client }) {
  const documents = clientDocuments(client);
  if (!documents.length) return <span className="document-empty">-</span>;

  return <div className="document-list">{documents.map((document, index) => <DocumentLinkItem key={`${document.name}-${index}`} document={document} />)}</div>;
}

function LiveOverview({ clients, isLoading }) {
  const totalReceived = clients.reduce((total, client) => total + (Number(client.received) || 0), 0);
  const outstanding = clients.reduce((total, client) => total + Math.max((Number(client.amount) || 0) - (Number(client.received) || 0), 0), 0);
  const activeWork = clients.filter((client) => client.status === "In Progress" || client.status === "Pending").length;
  const statuses = ["Completed", "In Progress", "Pending"];

  return <section className="live-overview">
    <div className="live-stat-grid">
      <article><span>Total clients</span><strong>{clients.length}</strong></article>
      <article><span>Active work</span><strong>{activeWork}</strong></article>
      <article><span>Total received</span><strong className={receivedTone(totalReceived)}>{formatMoney(totalReceived)}</strong></article>
      <article><span>Outstanding</span><strong className={pendingTone(outstanding)}>{formatMoney(outstanding)}</strong></article>
    </div>
    <div className="live-panels">
      <section className="panel live-status-panel"><div className="panel-heading"><div><h2>Work status</h2><p>Current client workload</p></div></div>
        <div className="live-status-list">{statuses.map((status) => <div key={status}><span>{status}</span><strong>{clients.filter((client) => client.status === status).length}</strong></div>)}</div>
      </section>
      <section className="panel live-activity-panel"><div className="panel-heading"><div><h2>Recently added clients</h2><p>Latest records from Firebase</p></div></div>
        {isLoading ? <div className="empty-state">Loading Firebase records...</div> : clients.length ? <div className="activity-list">{clients.slice(0, 3).map((client) => <div className="activity-item" key={client.id}><div className="activity-icon teal"><Icon name="users" size={15} /></div><div><strong>{client.name}</strong><p>{client.provider} · {client.owner || "Unassigned"}</p></div><time>{client.date || ""}</time></div>)}</div> : <div className="empty-state">No client records in Firebase yet.</div>}
      </section>
    </div>
  </section>;
}

function receivedTone(value) {
  const amount = Number(value) || 0;
  if (amount > 0) return "money-cell money-received";
  return "money-cell money-zero";
}

function pendingTone(value) {
  const amount = Number(value) || 0;
  if (amount > 0) return "money-cell money-pending";
  return "money-cell money-zero";
}

// One row per employee, built from the client records the caller is already
// allowed to read. A JN Technical only ever receives their own clients, so this
// collapses to a single bar; a manager receives the team's clients and sees one
// bar per person. Either way the numbers describe that employee's own work.
function buildWorkReport(clients, employees) {
  const byAssignee = new Map();
  clients.forEach((client) => {
    const key = client.assignedTo || client.owner || "unassigned";
    const current = byAssignee.get(key) || {
      key,
      name: client.owner || "Unassigned",
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      received: 0,
      outstanding: 0,
    };
    const amount = Number(client.amount) || 0;
    const received = Number(client.received) || 0;
    current.total += 1;
    if (client.status === "Completed") current.completed += 1;
    else if (client.status === "In Progress") current.inProgress += 1;
    else if (client.status === "Pending") current.pending += 1;
    current.received += received;
    current.outstanding += Math.max(amount - received, 0);
    byAssignee.set(key, current);
  });
  // Employees with no clients in scope still deserve a bar at zero, so their
  // report never silently disappears. The directory name wins over the record's
  // denormalised owner name, which can be stale after a rename.
  const nameByUid = new Map((employees || []).filter((employee) => employee?.uid).map((employee) => [employee.uid, employee.name || employee.roleLabel || "Employee"]));
  const rows = [...byAssignee.values()].map((row) => ({ ...row, name: nameByUid.get(row.key) || row.name || "Unassigned" }));
  const seen = new Set(rows.map((row) => row.key));
  (employees || []).forEach((employee) => {
    if (seen.has(employee.uid)) return;
    seen.add(employee.uid);
    rows.push({ key: employee.uid, name: employee.name, total: 0, completed: 0, inProgress: 0, pending: 0, received: 0, outstanding: 0 });
  });
  return rows.sort((a, b) => b.total - a.total || b.received - a.received || a.name.localeCompare(b.name));
}

function WorkReportChart({ clients, employees, role, previewName }) {
  const rows = useMemo(() => buildWorkReport(clients, employees), [clients, employees]);
  if (rows.length === 0) {
    return <div className="empty-state">No client records assigned within your scope yet.</div>;
  }
  const completion = (row) => row.total ? Math.round(row.completed / row.total * 100) : 0;
  const totals = rows.reduce((acc, row) => ({
    total: acc.total + row.total,
    completed: acc.completed + row.completed,
    received: acc.received + row.received,
    outstanding: acc.outstanding + row.outstanding,
  }), { total: 0, completed: 0, received: 0, outstanding: 0 });

  return <div className="work-report">
    <div className="work-report-summary">
      <article><span>{previewName ? `${previewName}'s clients` : "Clients in scope"}</span><strong>{totals.total}</strong></article>
      <article><span>Completed</span><strong>{totals.completed}</strong></article>
      <article><span>Received</span><strong className={receivedTone(totals.received)}>{formatMoney(totals.received)}</strong></article>
      <article><span>Outstanding</span><strong className={pendingTone(totals.outstanding)}>{formatMoney(totals.outstanding)}</strong></article>
    </div>
    <div className="work-report-heading"><h3>{rows.length === 1 ? `${rows[0].name} — work overview` : "Work overview by employee"}</h3><p>{rows.length === 1 ? `Scoped to the ${role} view` : "Client load and payment progress for each employee in your scope"}</p></div>
    <div className="employee-chart-grid">
      {rows.map((row) => <article className="employee-chart-card" key={row.key}>
        <header className="employee-chart-header">
          <div className="work-report-person"><div className="owner-avatar">{String(row.name || "?").split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</div><div><strong>{row.name || "Unassigned"}</strong><span>Individual performance · All records</span></div></div>
          <span className="completion-chip">{completion(row)}% completed</span>
        </header>
        <div className="employee-chart-body">
          <ReportColumns title="Work performance" items={[
            { label: "Assigned", value: row.total, color: "#647caa" },
            { label: "Completed", value: row.completed, color: "#197f73" },
            { label: "In progress", value: row.inProgress, color: "#e8b74b" },
            { label: "Pending", value: row.pending, color: "#e88974" },
            { label: "Other", value: row.total - row.completed - row.inProgress - row.pending, color: "#a6b3b0" },
          ]} />
          <ReportColumns title="Payment overview" money items={[
            { label: "Received", value: row.received, color: "#197f73" },
            { label: "Outstanding", value: row.outstanding, color: "#e88974" },
          ]} />
        </div>
        <footer className="employee-chart-footer"><span>{row.total} assigned clients</span><span>{row.total === 0 ? "No work assigned yet" : `${row.completed} completed · ${row.inProgress + row.pending} awaiting completion`}</span></footer>
      </article>)}
    </div>
  </div>;
}

function ReportColumns({ title, items, money = false }) {
  const largest = Math.max(1, ...items.map((item) => item.value));
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const step = Math.max(money ? 0.25 : 1, Math.ceil(largest / magnitude / 4) * magnitude);
  const maximum = step * 4;
  const formatTick = (value) => money ? (value >= 1000000 ? `${value / 1000000}m` : value >= 1000 ? `${value / 1000}k` : String(value)) : String(value);
  return <section className="report-columns" aria-label={title}>
    <div className="report-columns-title"><h4>{title}</h4><span>{money ? "PKR" : "CLIENTS"}</span></div>
    <div className="report-plot">
      <div className="report-gridlines" aria-hidden="true">{[4, 3, 2, 1, 0].map((tick) => <div key={tick}><span>{formatTick(tick * step)}</span><i /></div>)}</div>
      <div className="report-column-groups">{items.map((item) => <div className="report-column-slot" key={item.label}>
        <button type="button" className="report-column" style={{ height: `${item.value / maximum * 100}%`, "--bar-color": item.color }} aria-label={`${item.label}: ${money ? formatMoney(item.value) : item.value}`}>
          <span className="report-column-value">{formatTick(item.value)}</span>
          <span className="report-column-tooltip">{item.label}<strong>{money ? formatMoney(item.value) : `${item.value} clients`}</strong></span>
        </button>
        <span className="report-column-label">{item.label}</span>
      </div>)}</div>
    </div>
  </section>;
}

function downloadExcelRecords(records) {
  const headers = ["S.NO", "Date", "Shift", "Assigned At", "Client Name", "Client Provider", "Cell", "CNIC", "PIN", "Password", "Email", "Work", "Description", "Total Amount", "Received Amount", "Remaining Amount", "Payment Status"];
  const rows = records.map((client, index) => [index + 1, client.date || "", workShiftLabel(client), assignedAtLabel(client), client.name, client.provider, client.cell || "", client.cnic || "", client.pin || "", client.password || "", client.email || "", client.work || client.provider, client.description || "", client.amount || 0, client.received || 0, Math.max((client.amount || 0) - (client.received || 0), 0), client.payment || "Pending"]);
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function dataUrlToBlob(dataUrl) {
  const [header = "", encoded = ""] = String(dataUrl).split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function openDocumentInNewTab(document) {
  // A Storage download URL opens directly; a legacy base64 payload is converted
  // to a blob first so the browser can display it in a new tab.
  const directUrl = String(document?.url || "");
  if (directUrl) {
    window.open(directUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const dataUrl = String(document?.dataUrl || "");
  if (!dataUrl) return;
  const url = dataUrl.startsWith("data:") ? URL.createObjectURL(dataUrlToBlob(dataUrl)) : dataUrl;
  window.open(url, "_blank", "noopener,noreferrer");
  if (url !== dataUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function PasswordField({ label, value, onChange, placeholder, minLength = 8, name, required = true, autoComplete }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <label>
      {label}
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #dfe3ea", borderRadius: 10, background: "#fff", padding: "0 10px" }}>
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          minLength={minLength}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          style={{ border: "none", outline: "none", background: "transparent", flex: 1, padding: "12px 0" }}
        />
        <button type="button" onClick={() => setShowPassword((current) => !current)} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#374151", fontSize: 14, fontWeight: 600, padding: 0 }}>
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

const roleNames = { sub_admin: "Sub Admin", social_media: "Social Media", senior_technical: "Senior Technical", jn_technical: "JN Technical" };

// The Team view is built from the employee list, so a denied or failing employee
// read used to render as "No team members in your scope" — which reads as "your
// team is empty" even when the team exists and only the read failed. Track that
// state separately so the header can say what actually happened.
function emptyTeamNotice(session, error, hasLoaded) {
  if (!hasLoaded) return "Loading team...";
  const role = session?.role;
  if (role !== "sub_admin" && role !== "social_media" && role !== "senior_technical") {
    return "No team members in your scope";
  }
  const canReadTeam = [
    "manage_lower_employees",
    "manage_junior_employees",
    "manage_assignments",
  ].some((permission) => session.permissions?.includes(permission));
  if (!canReadTeam) return "No team members in your scope";
  if (error) return "Team list could not load. Check your connection and refresh.";
  return "No team members yet — ask your Admin to assign staff under your account.";
}

// Firestore stores the role code; the UI shows the label. Normalised once here
// so both the section refresh and the team-list load agree.
function formatEmployee(employee) {
  return {
    ...employee,
    roleCode: employee.role,
    role: roleNames[employee.role] || employee.role,
    status: employee.status === "active" ? "Active" : "Inactive",
    initials: employee.name?.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "",
  };
}

async function loadTeamList(user, requestApi, recordCacheRef, setEmployeeRecords, setAssignableEmployeeRecords) {
  const result = await requestApi("employees", "GET", undefined, user);
  recordCacheRef.current.employees = Date.now();
  setEmployeeRecords(result.employees.map(formatEmployee));
  setAssignableEmployeeRecords((result.assignableEmployees || result.employees).map(formatEmployee));
}

function WorkspaceView({ section, role, clients, employeeRecords, assignableEmployees = employeeRecords, serviceRecords, paymentRecords, query, setQuery, onAction, onClientStatusChange, onClientTransfer, onViewClient, onEditClient, onDeleteClient, onEditEmployee, onDeleteEmployee, onResetEmployeePassword, onEmployeePermissionsChange, currentUid, canManageEmployees, canManagePermissions, canManageServices, canAddClient, employeeRoleOptions, assignableRoleOptions, readOnlyPreview, isAdmin, onEditPayment, onDeletePayment }) {
  const sectionMeta = {
    Clients: { title: "Clients", subtitle: "Only clients available to your current role are shown.", action: "Add client" },
    Employees: { title: "Employees", subtitle: "Manage team access and assigned workload.", action: "Add employee" },
    Services: { title: "Services", subtitle: "Your practice services and their active client assignments.", action: "Add service" },
    Payments: { title: "Payments", subtitle: "Track received installments and outstanding balances.", action: "Record payment" },
    Reports: { title: "Reports", subtitle: "Operational reports generated from authorized records.", action: "Export report" },
    "Excel records": { title: "Excel records", subtitle: "Completed records available within your permission scope.", action: "Download Excel" },
  };
  const meta = sectionMeta[section] || sectionMeta.Clients;
  // Edit/delete only for the person who gave the client (its assigner/creator)
  // and the Admin. The current holder and every other role never see these
  // buttons — matching canManageClientRecord in firestore.rules.
  const canManageClient = (client) =>
    isAdmin || (client.assignedBy || client.createdBy) === currentUid;
  // Edit/delete for payments: only the person who recorded the payment (or the
  // Admin) sees the buttons — matching canManagePaymentRecord in firestore.rules.
  const canManagePayment = (payment) =>
    isAdmin || payment.recordedBy === currentUid;
  const [permissionEmployeeUid, setPermissionEmployeeUid] = useState("");
  const [permissionDrafts, setPermissionDrafts] = useState([]);
  // Tables paint this many rows at a time. A 14-column table with thousands of
  // rows is what makes the page (not the network) feel frozen while typing.
  // Resetting the window is derived from the current filters instead of an
  // effect, so switching tabs or searching never triggers a cascading render.
  const [rowWindow, setRowWindow] = useState({ key: "", count: TABLE_PAGE_SIZE });
  const rowWindowKey = `${section}|${query}`;
  const visibleRowCount = rowWindow.key === rowWindowKey ? rowWindow.count : TABLE_PAGE_SIZE;
  const showMoreRows = () => setRowWindow({ key: rowWindowKey, count: visibleRowCount + TABLE_PAGE_SIZE });

  const normalizedQuery = query.toLowerCase();
  const scopedEmployees = employeeRecords;
  const matchingClients = useMemo(
    // Reports used to drop every client not personally held by the caller
    // (assignedTo === self), which left the chart with zero records even for a
    // manager whose whole team is loaded — every bar then read 0. The chart is
    // a per-employee breakdown of the caller's own authorized scope, so it gets
    // the same client set as every other section; only the search text filters.
    () => clients.filter((client) => `${client.name} ${client.provider} ${client.owner}`.toLowerCase().includes(normalizedQuery)),
    [clients, normalizedQuery],
  );
  const filteredClients = useMemo(() => {
    // The Clients section lists only the clients the caller currently holds
    // (assignedTo === self): clients they created and handed to someone else
    // stay visible on Overview, but never re-appear in the Clients workspace.
    // Admin and Sub Admin keep their full team scope — Sub Admin manages the
    // whole team's clients under its Admin-granted permissions.
    const clientsSectionScope =
      section === "Clients" && !isAdmin && role !== "Sub Admin";
    const scoped = clientsSectionScope
      ? matchingClients.filter((client) => client.assignedTo === currentUid)
      : matchingClients;
    return section === "Excel records"
      ? scoped.filter((client) => client.status === "Completed")
      : section === "Clients"
        ? scoped.filter((client) => client.status !== "Completed")
        : scoped;
  }, [matchingClients, section, isAdmin, role, currentUid]);
  // Memoized so typing in the search box only re-filters, instead of also
  // rebuilding every row of every table on each keystroke.
  const filteredEmployees = useMemo(
    () => scopedEmployees.filter((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(normalizedQuery)),
    [scopedEmployees, normalizedQuery],
  );
  const filteredServices = useMemo(
    () => serviceRecords.filter((service) => `${service.name} ${service.category}`.toLowerCase().includes(normalizedQuery)),
    [serviceRecords, normalizedQuery],
  );
  const filteredPayments = useMemo(
    () => {
      const reportClientIds = new Set(filteredClients.map((client) => client.id));
      return paymentRecords.filter((payment) => (section !== "Reports" || reportClientIds.has(payment.clientId)) && `${payment.clientName} ${payment.date} ${payment.usedFor || ""}`.toLowerCase().includes(normalizedQuery));
    },
    [paymentRecords, normalizedQuery, filteredClients, section],
  );
  // Assignment targets are filtered on assignableRoleOptions, not
  // employeeRoleOptions: the latter is the (empty, for Social Media) set of
  // roles it may create, and reusing it here left the reassign / create-client
  // dropdowns empty for every role that distributes clients without staffing.
  const activeAssignableEmployees = useMemo(
    () => assignableEmployees.filter((employee) => employee.status === "Active" && assignableRoleOptions.some((employeeRole) => roleNames[employeeRole] === employee.role)),
    [assignableEmployees, assignableRoleOptions],
  );

  // "Assigned clients" used to re-scan the whole client list once per employee
  // row (O(employees x clients)); one pass over the clients gives every count.
  const clientsPerAssignee = useMemo(() => {
    const counts = new Map();
    for (const client of clients) {
      counts.set(client.assignedTo, (counts.get(client.assignedTo) || 0) + 1);
    }
    return counts;
  }, [clients]);
  const showAction = !readOnlyPreview && ((section === "Employees" && canManageEmployees) || (section === "Clients" && canAddClient) || (section === "Services" && canManageServices) || (section === "Payments" && clients.length > 0));

  // Clients section uses page-number pagination (like the Overview table): 50
  // records per page with ‹ / page numbers / › controls, instead of the old
  // cumulative "Show more" window. Excel records keep the same page state.
  const [clientPage, setClientPage] = useState(1);
  const clientPageCount = Math.max(1, Math.ceil(filteredClients.length / TABLE_PAGE_SIZE));
  const currentClientPage = Math.min(clientPage, clientPageCount);
  const pagedClientRows = useMemo(() => filteredClients.slice(
    (currentClientPage - 1) * TABLE_PAGE_SIZE,
    currentClientPage * TABLE_PAGE_SIZE,
  ), [filteredClients, currentClientPage]);
  const setClientPageSafe = (page) => setClientPage(Math.min(Math.max(1, page), clientPageCount));

  const tableRows = filteredClients.slice(0, visibleRowCount);
  const hasMoreRows = filteredClients.length > tableRows.length;
  const moreRows = hasMoreRows
    ? <button type="button" className="secondary-button load-more-button" onClick={showMoreRows}>Show {Math.min(TABLE_PAGE_SIZE, filteredClients.length - tableRows.length)} more of {filteredClients.length} records</button>
    : null;

  return <section className="workspace-view">
    <div className="workspace-header"><div><p className="eyebrow">{role} workspace</p><h2>{meta.title}</h2><p>{meta.subtitle}</p></div>{section === "Excel records" ? <button className="primary-button" onClick={() => downloadExcelRecords(filteredClients)}><Icon name="file" size={16} /> {meta.action}</button> : showAction && <button className="primary-button" onClick={() => onAction(section === "Employees" ? "employee" : section === "Clients" ? "client" : section === "Services" ? "service" : "payment")}><Icon name="plus" size={17} /> {meta.action}</button>}</div>
    <div className="workspace-summary"><div className="summary-tile"><span>Visible records</span><strong>{section === "Employees" ? filteredEmployees.length : section === "Services" ? filteredServices.length : section === "Payments" ? filteredPayments.length : filteredClients.length}</strong><small>Scoped to your access</small></div><div className="summary-tile"><span>Active {section.toLowerCase()}</span><strong>{section === "Employees" ? filteredEmployees.filter((item) => item.status === "Active").length : section === "Services" ? filteredServices.filter((item) => item.status === "Active").length : section === "Payments" ? filteredPayments.length : filteredClients.filter((item) => item.status !== "Completed").length}</strong><small>Currently in progress</small></div><div className="summary-tile"><span>Role scope</span><strong className="scope-value">{role}</strong><small><span className="secure-dot" /> Protected view</small></div></div>
    <div className="panel workspace-panel"><div className="workspace-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${section.toLowerCase()}...`} /></div><button className="filter-button">Filter <span>⌄</span></button></div>
      {section === "Clients" && !readOnlyPreview && filteredClients.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); const client = clients.find((item) => item.id === formData.get("clientId")); if (client) onClientStatusChange(client, formData.get("status")); }}><label>Client work status<select name="clientId" required defaultValue="">{filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.work || client.provider}</option>)}</select></label><label>Status<select name="status" defaultValue="Pending">{["New", "Pending", "In Progress", "Completed", "Cancelled"].map((status) => <option key={status}>{status}</option>)}</select></label><div className="modal-actions"><button className="primary-button">Update work status</button></div></form>}
      {section === "Clients" && !readOnlyPreview && activeAssignableEmployees.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); onClientTransfer(formData.get("clientId"), formData.get("assignedTo")); }}><label>Client to reassign<select name="clientId" required defaultValue="">{filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.owner}</option>)}</select></label><label>New assignee<select name="assignedTo" required defaultValue=""><option value={currentUid}>{role === "admin" ? "Admin" : role} · Myself</option>{activeAssignableEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label><div className="modal-actions"><button className="primary-button">Reassign client</button></div></form>}
      {section === "Employees" && <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Role</th><th>Assigned clients</th><th>Account status</th><th>Created by</th>{!readOnlyPreview && <th>Actions</th>}</tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.uid}><td><div className="client-cell"><div className="client-avatar mint">{employee.initials}</div><div><strong>{employee.name}</strong><span>{employee.email}</span></div></div></td><td>{employee.role}</td><td>{clientsPerAssignee.get(employee.uid) || 0} clients</td><td><span className={`status-badge ${employee.status === "Active" ? "completed" : "pending"}`}><i />{employee.status}</span></td><td>{employee.createdBy === currentUid ? "You" : employee.createdBy}</td>{!readOnlyPreview && <td><button className="text-button" onClick={() => onEditEmployee(employee)}>Edit</button><button className="text-button" onClick={() => onResetEmployeePassword(employee)}>Reset password</button><button className="client-delete-button" onClick={() => onDeleteEmployee(employee)}>Delete</button></td>}</tr>)}</tbody></table></div>}
      {section === "Employees" && !readOnlyPreview && canManagePermissions && filteredEmployees.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); onEmployeePermissionsChange(permissionEmployeeUid, permissionDrafts); }}>
        <label>Employee permissions<select required value={permissionEmployeeUid} onChange={(event) => { const employee = filteredEmployees.find((item) => item.uid === event.target.value); setPermissionEmployeeUid(event.target.value); setPermissionDrafts(employee?.permissions || []); }}><option value="">Choose employee</option>{filteredEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name}</option>)}</select></label>
        <div className="permission-checkboxes">{["manage_employees", "manage_permissions", "manage_lower_employees", "manage_junior_employees", "manage_clients", "manage_assignments"].map((permission) => <label key={permission}><input type="checkbox" checked={permissionDrafts.includes(permission)} onChange={(event) => setPermissionDrafts((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))} />{permission.replaceAll("_", " ")}</label>)}</div>
        <div className="modal-actions"><button className="primary-button" disabled={!permissionEmployeeUid}>Save permissions</button></div>
      </form>}
      {section === "Clients" && <div className="table-scroll"><table className="client-record-table"><thead><tr><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Description</th><th>Documents</th><th>Pending</th><th>Received</th><th>Actions</th></tr></thead><tbody>{pagedClientRows.map((client) => <tr key={client.id}><td className="date-cell"><DateCell date={client.date || "29 Sep 2026"} client={client} /></td><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password || "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td title={client.description || ""}>{client.description || "-"}</td><td><DocumentLink client={client} /></td><td className={pendingTone(Math.max(client.amount - client.received, 0))}>{formatMoney(Math.max(client.amount - client.received, 0))}</td><td className={receivedTone(client.received)}>{formatMoney(client.received)}</td><td><ClientRowActions client={client} canManage={!readOnlyPreview && canManageClient(client)} onViewClient={onViewClient} onEditClient={onEditClient} onDeleteClient={onDeleteClient} /></td></tr>)}</tbody></table>{filteredClients.length === 0 && <div className="empty-state">No authorized clients match this search.</div>}</div>}
      {section === "Clients" && <div className="table-footer"><span>Showing <strong>{pagedClientRows.length}</strong> of <strong>{filteredClients.length}</strong> client records</span><div className="pagination"><button disabled={currentClientPage <= 1} onClick={() => setClientPageSafe(currentClientPage - 1)}>‹</button>{Array.from({ length: clientPageCount }, (_, index) => index + 1).map((page) => <button key={page} className={page === currentClientPage ? "current" : ""} onClick={() => setClientPageSafe(page)}>{page}</button>)}<button disabled={currentClientPage >= clientPageCount} onClick={() => setClientPageSafe(currentClientPage + 1)}>›</button></div></div>}
      {section === "Services" && <div className="table-scroll"><table><thead><tr><th>Service</th><th>Category</th><th>Active clients</th><th>Collected</th><th>Status</th><th /></tr></thead><tbody>{filteredServices.map((service) => <tr key={service.id || service.name}><td><div className="service-cell"><div className="service-icon"><Icon name="layers" size={15} /></div><strong>{service.name}</strong></div></td><td>{service.category}</td><td>{service.clients}</td><td className="money-cell">{typeof service.amount === "number" ? formatMoney(service.amount) : service.amount}</td><td><span className="status-badge completed"><i />{service.status}</span></td><td><button className="row-more">•••</button></td></tr>)}</tbody></table></div>}
      {section === "Excel records" && <div className="table-scroll"><table className="excel-record-table"><thead><tr><th>S.NO</th><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Description</th><th>Total Amount</th><th>Received Amount</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{tableRows.map((client, index) => <tr key={client.id}><td>{index + 1}</td><td><DateCell date={client.date || "29 Sep 2026"} client={client} /></td><td><strong>{client.name}</strong><span className="record-id">{client.id}</span></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password || "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td>{client.description || "-"}</td><td>{formatMoney(client.amount)}</td><td className={receivedTone(client.received)}>{formatMoney(client.received)}</td><td className={pendingTone(Math.max(client.amount - client.received, 0))}>{formatMoney(Math.max(client.amount - client.received, 0))}</td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span></td></tr>)}</tbody></table>{moreRows && <div className="table-more">{moreRows}</div>}</div>}
      {section === "Payments" && <div className="table-scroll"><table><thead><tr><th>Client</th><th>Payment date</th><th>Payment At:</th><th>Amount received</th><th>Recorded by</th>{!readOnlyPreview && <th>Actions</th>}</tr></thead><tbody>{filteredPayments.map((payment) => <tr key={payment.id}><td>{payment.clientName}</td><td>{payment.date}</td><td>{payment.usedFor || "-"}</td><td className="money-cell">{formatMoney(Number(payment.amount) || 0)}</td><td>{payment.recordedByName && payment.recordedByName !== payment.recordedBy ? payment.recordedByName : "Unknown user"}</td>{!readOnlyPreview && <td>{canManagePayment(payment) && <div className="client-row-actions"><button type="button" className="text-button" onClick={() => onEditPayment(payment)}>Edit</button><button type="button" className="client-delete-button" onClick={() => onDeletePayment(payment)}>Delete</button></div>}</td>}</tr>)}</tbody></table>{filteredPayments.length === 0 && <div className="empty-state">No authorized payment records yet.</div>}</div>}
      {section === "Reports" && <div className="work-report-panel">
        <WorkReportChart clients={filteredClients} employees={isAdmin ? scopedEmployees : (scopedEmployees.length ? scopedEmployees : [{ uid: currentUid, name: clients.find((client) => client.assignedTo === currentUid)?.owner || "My performance" }])} role={role} previewName={readOnlyPreview ? role.replace(/^Preview:\s*/, "") : ""} />
        <div className="work-report-footer"><span>{filteredClients.length} clients · {filteredPayments.length} payments · {formatMoney(filteredPayments.reduce((total, payment) => total + (Number(payment.amount) || 0), 0))} received</span><button className="text-button" onClick={() => downloadExcelRecords(filteredClients)}><Icon name="file" size={15} /> Export report</button></div>
      </div>}
      {((section === "Employees" && filteredEmployees.length === 0) || (section === "Clients" && filteredClients.length === 0) || (section === "Services" && filteredServices.length === 0)) && <div className="empty-state">No authorized {section.toLowerCase()} match this search.</div>}
    </div>
  </section>;
}

export function CrmWorkspace({ initialSession }) {
  const [session, setSession] = useState(() => {
    return initialSession || null;
  });
  const role = session?.roleLabel || "Admin";
  const [teamView, setTeamView] = useState("All teams");
  // Portal/Team preview is an Admin and Sub Admin inspection tool. A Senior
  // Technical or Social Media account can never open another employee's view:
  // their data set is strictly their own, so previewing anyone else would be a
  // direct isolation violation (§3/§5).
  const canPreviewTeam =
    session?.role === "admin" || session?.role === "sub_admin";
  const [activeNav, setActiveNav] = useState("Overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All clients");
  const [clientRecords, setClientRecords] = useState([]);
  const [employeeRecords, setEmployeeRecords] = useState([]);
  const [assignableEmployeeRecords, setAssignableEmployeeRecords] = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [modal, setModal] = useState(null);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [clientToView, setClientToView] = useState(null);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const [paymentToDelete, setPaymentToDelete] = useState(null);
  const [savingAction, setSavingAction] = useState(null);
  const submitLock = useRef(false);
  const [clientForm, setClientForm] = useState({ date: new Date().toISOString().slice(0, 10), workTime: new Date().toTimeString().slice(0, 5), name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", assignedTo: "", assignedShift: "", amount: "", received: "", usedFor: "" });
  const [clientDocuments, setClientDocuments] = useState([]);
  const [isSavingDocuments, setIsSavingDocuments] = useState(false);
  const [clientEditForm, setClientEditForm] = useState({ id: "", date: "", workTime: "", name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", totalAmount: "", totalReceived: "", usedFor: "" });
  const [paymentForm, setPaymentForm] = useState({ clientId: "", amount: "", date: new Date().toISOString().slice(0, 10), usedFor: "" });
  const [paymentEditForm, setPaymentEditForm] = useState({ id: "", clientId: "", amount: "", date: "", usedFor: "" });
  const [serviceForm, setServiceForm] = useState({ name: "", category: "" });
  const [employeeEditForm, setEmployeeEditForm] = useState({ uid: "", name: "", email: "", phone: "", role: "" });
  const [newEmployeeRole, setNewEmployeeRole] = useState("");
  const [passwordResetForm, setPasswordResetForm] = useState({ uid: "", password: "", confirmPassword: "" });
  // Every role a caller outranks, mirroring roleOrder in app/lib/roles.js:
  // Admin staffs the whole tree, Social Media and Sub Admin create the roles
  // beneath them, and a Senior Technical creates JN Technical accounts.
  // Everything below reads the session defensively: the workspace can mount for
  // a beat before the signed-in profile arrives (or while a cached session is
  // being revalidated), and reportableRoles(undefined) safely returns [].
  const sessionPermissions = useMemo(() => session?.permissions || [], [session?.permissions]);
  const employeeRoleOptions = reportableRoles(session?.role);
  const employeePermission = ({ admin: "manage_employees", social_media: "manage_lower_employees", sub_admin: "manage_lower_employees", senior_technical: "manage_junior_employees" })[session?.role];
  const canManageEmployees = employeeRoleOptions.length > 0 && sessionPermissions.includes(employeePermission);
  // Who this account may hand a client to: every role it outranks, matching
  // getAssignableProfiles in app/lib/crm-data.js. It mirrors employeeRoleOptions
  // today but is kept separate so assignment targets never silently follow a
  // future change to who may be staffed.
  const assignableRoleOptions = reportableRoles(session?.role);
  const canManageServices = sessionPermissions.includes("manage_clients");
  // Client creation is gated on the assignment permission alone, never on
  // employeeRoleOptions: a role that distributes clients must see Add client
  // even if it staffs nobody.
  const canAddClient = sessionPermissions.includes("manage_assignments");
  const visibleNavItems = navItems.filter(([label]) => {
    if (label === "Employees") return canManageEmployees || sessionPermissions.includes("manage_assignments");
    if (session?.role === "jn_technical") return ["Overview", "Clients", "Services", "Payments", "Reports", "Excel records"].includes(label);
    return true;
  });

  // Timestamps of the last successful read of each record set, keyed by
  // endpoint. Kept in a ref so refreshing does not re-create the callbacks.
  const recordCacheRef = useRef({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const requestApi = useCallback(
    (path, method = "GET", body, user = firebaseUser) =>
      crmRequest(user, path, method, body),
    [firebaseUser],
  );

  const refreshRecords = useCallback(async (user, section, { force = false } = {}) => {
    const endpoints = { clients: "clients", employees: "employees", services: "services", payments: "payments" };
    const canViewEmployees = ["manage_employees", "manage_lower_employees", "manage_junior_employees", "manage_assignments"]
      .some((permission) => sessionPermissions.includes(permission));
    const requestedData = (sectionDataPlan[section] || ["clients"])
      .filter((key) => key !== "employees" || canViewEmployees);

    const now = Date.now();
    const stale = requestedData.filter((key) => force || !recordCacheRef.current[key] || now - recordCacheRef.current[key] >= RECORD_CACHE_MS);
    if (stale.length === 0) return;

    setIsRefreshing(true);
    try {
      const settledResults = await Promise.allSettled(stale.map((key) => requestApi(endpoints[key], "GET", undefined, user)));
      const results = Object.fromEntries(settledResults.map((result, index) => [
        stale[index],
        result.status === "fulfilled" ? result.value : null,
      ]));
      const failures = settledResults.flatMap((result, index) => result.status === "rejected"
        ? [`${stale[index]}: ${result.reason?.message || "Unknown error"}`]
        : []);
      settledResults.forEach((result, index) => {
        if (result.status === "fulfilled") recordCacheRef.current[stale[index]] = Date.now();
      });
      const { clients: clientResult, employees: employeeResult, services: serviceResult, payments: paymentResult } = results;

      if (clientResult) {
        setClientRecords(clientResult.clients.map((client) => ({
          ...client,
          date: client.date || "-",
          owner: client.assignedToName || client.owner || "",
          amount: Number(client.totalAmount ?? client.amount) || 0,
          received: Number(client.totalReceived ?? client.received) || 0,
          initials: client.initials || client.name?.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "",
          color: client.color || "mint",
          status: client.status || "Pending",
          // Derived from the amounts rather than trusting the stored value: rows
          // written before the status rule changed still carry "Partial", and an
          // outstanding balance must always read as "Pending".
          payment:
            Number(client.totalAmount ?? client.amount) > 0 &&
            Number(client.totalReceived ?? client.received) >= Number(client.totalAmount ?? client.amount)
              ? "Received"
              : "Pending",
        })).sort((first, second) => String(second.date || "").localeCompare(String(first.date || ""))));
      }
      if (employeeResult) {
        setEmployeeRecords(employeeResult.employees.map(formatEmployee));
        setAssignableEmployeeRecords(
          (employeeResult.assignableEmployees || employeeResult.employees).map(formatEmployee),
        );
      }
      if (serviceResult) setServiceRecords(serviceResult.services);
      if (paymentResult) setPaymentRecords(paymentResult.payments);

      if (failures.length > 0) {
        setDataError(`Some records could not refresh: ${failures.join("; ")}`);
      } else {
        setDataError("");
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [requestApi, sessionPermissions]);

  // Record sets are cached for a short window, so the tab that is actually on
  // screen decides what to load: it blocks on its own data the first time, then
  // silently revalidates once the data is stale instead of freezing the view.
  const loadSection = useCallback(async (user, section, { force = false, withTeam = false } = {}) => {
    if (force) recordCacheRef.current = {};
    const now = Date.now();
    const canViewEmployees = ["manage_employees", "manage_lower_employees", "manage_junior_employees", "manage_assignments"]
      .some((permission) => sessionPermissions.includes(permission));
    const requestedData = (sectionDataPlan[section] || ["clients"])
      .filter((key) => key !== "employees" || canViewEmployees);

    // The team list backs the Team view dropdown on every section, so the first
    // load of a session always fetches it — separately from the section's own
    // data, because it returns two lists (managed + assignable) the generic
    // endpoint handling does not know about.
    const teamIsStale = canViewEmployees && withTeam &&
      (!recordCacheRef.current.employees || now - recordCacheRef.current.employees >= RECORD_CACHE_MS);

    const isStale = (key) => !recordCacheRef.current[key] || now - recordCacheRef.current[key] >= RECORD_CACHE_MS;
    if (teamIsStale || requestedData.some(isStale)) setIsLoading(true);

    if (teamIsStale) {
      // Started before awaiting the section reads so both hit the network in
      // parallel rather than queueing behind each other.
      await Promise.allSettled([
        refreshRecords(user, section, { force }),
        loadTeamList(user, requestApi, recordCacheRef, setEmployeeRecords, setAssignableEmployeeRecords),
      ]);
      return;
    }
    await refreshRecords(user, section, { force });
  }, [refreshRecords, requestApi, sessionPermissions]);

  const hasLoadedDataRef = useRef(false);

  useEffect(() => {
    return subscribeToAuthUser((user) => {
      // Switching accounts must never show the previous session's records.
      if (user?.uid !== firebaseUser?.uid) {
        recordCacheRef.current = {};
        hasLoadedDataRef.current = false;
      }
      setFirebaseUser(user);
    });
  }, [firebaseUser?.uid]);

  // Profile + first section load, started together instead of waiting on each
  // other. The workspace is marked ready as soon as this settles, which is one
  // batch of reads rather than the previous stack of sequential ones.
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    // The team list is loaded inline (rather than through the plain section
    // refresh) because it returns two lists — managed and assignable — that the
    // generic endpoint handling does not know about.
    loadSection(firebaseUser, activeNav, { withTeam: true })
      .catch((error) => setDataError(`Could not load authorized records: ${error.message}`))
      .finally(() => {
        if (cancelled) return;
        hasLoadedDataRef.current = true;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || !hasLoadedDataRef.current) return;
    loadSection(firebaseUser, activeNav)
      .catch((error) => setDataError(`Could not load authorized ${activeNav.toLowerCase()} records: ${error.message}`));
  }, [firebaseUser, activeNav, loadSection]);
  // Admins, Sub Admins, and Senior Technicals can open a lower-ranked employee's
  // view to inspect the work that employee owns (employers must match canReadUser
  // in firestore.rules, so only directly-managed people appear here).
  const teamViewEmployeeIds = useMemo(() => {
    const ids = new Set();
    // Seed with the selected employee's own uid: their clients are assigned to
    // them directly (assignedTo === teamView), not only to the people beneath
    // them. Without this seed the preview filtered those clients out and showed
    // zero payments for the very employee whose portal is being inspected.
    if (teamView) ids.add(teamView);
    let changed = true;
    while (changed) {
      changed = false;
      for (const employee of employeeRecords) {
        if ((employee.uid === teamView || ids.has(employee.managerUid || employee.createdBy)) && !ids.has(employee.uid)) {
          ids.add(employee.uid);
          changed = true;
        }
      }
    }
    return ids;
  }, [employeeRecords, teamView]);
  const previewEmployeeUids = canPreviewTeam && teamView !== "All teams" ? teamViewEmployeeIds : null;
  const isAdminPreview = canPreviewTeam && teamView !== "All teams";
  // Employees a signed-in user may open in the Team view: everyone the caller
  // outranks, derived from the one role order so a reordering never leaves a
  // stale hard-coded role list behind. Admin sees the whole directory. The
  // teammate currently selected stays in the list even while the scoped record
  // set is still loading.
  const teamViewEmployees = useMemo(() => {
    if (!canPreviewTeam) return [];
    const canSeeEmployee = (employee) =>
      session?.role === "admin" || isRoleBelow(session?.role, employee.roleCode || employee.role);
    const options = employeeRecords.filter(canSeeEmployee);
    if (!options.some((employee) => employee.uid === teamView)) {
      const selected = employeeRecords.find((employee) => employee.uid === teamView);
      if (selected) options.unshift(selected);
    }
    return options;
  }, [canPreviewTeam, employeeRecords, session?.role, teamView]);
  const canOpenTeamView = canPreviewTeam && teamViewEmployees.length > 0;
  const scopedClients = useMemo(() => previewEmployeeUids
    ? clientRecords.filter((client) => previewEmployeeUids.has(client.assignedTo))
    : clientRecords, [clientRecords, previewEmployeeUids]);
  const scopedClientIds = useMemo(() => new Set(scopedClients.map((client) => client.id)), [scopedClients]);
  const scopedPayments = useMemo(() => previewEmployeeUids
    ? paymentRecords.filter((payment) => scopedClientIds.has(payment.clientId))
    : paymentRecords, [paymentRecords, previewEmployeeUids, scopedClientIds]);
  const scopedEmployees = useMemo(() => previewEmployeeUids
    ? employeeRecords.filter((employee) => employee.uid !== teamView && previewEmployeeUids.has(employee.uid))
    : employeeRecords, [employeeRecords, previewEmployeeUids, teamView]);
  const scopedServices = useMemo(() => previewEmployeeUids
    ? serviceRecords.filter((service) => previewEmployeeUids.has(service.assignedTo) || previewEmployeeUids.has(service.createdBy) || scopedClientIds.has(service.clientId))
    : serviceRecords, [previewEmployeeUids, scopedClientIds, serviceRecords]);
  const scope = { clients: scopedClients };
  const visibleClients = useMemo(() => scope.clients.filter((client) => {
    const matchesQuery = `${client.name} ${client.provider} ${client.owner}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All clients" || client.status === filter;
    return matchesQuery && matchesFilter;
  }), [scope.clients, query, filter]);

  // Overview table pagination: 10 clients per page. Resetting to page 1 whenever
  // the filtered set shrinks past the current page keeps the view valid after a
  // search, filter change, or data refresh.
  const OVERVIEW_PAGE_SIZE = 10;
  const [overviewPage, setOverviewPage] = useState(1);
  const overviewPageCount = Math.max(1, Math.ceil(visibleClients.length / OVERVIEW_PAGE_SIZE));
  const currentOverviewPage = Math.min(overviewPage, overviewPageCount);
  const pagedOverviewClients = useMemo(() => visibleClients.slice(
    (currentOverviewPage - 1) * OVERVIEW_PAGE_SIZE,
    currentOverviewPage * OVERVIEW_PAGE_SIZE,
  ), [visibleClients, currentOverviewPage]);
  const setOverviewPageSafe = (page) => setOverviewPage(Math.min(Math.max(1, page), overviewPageCount));
  // No effect needed to reset the page on search/filter changes: the displayed
  // page is clamped against the current page count, so a shrinking result set
  // simply renders its last valid page instead of an empty one.

  const openModal = (type) => {
    if (type === "client") {
      setClientDocuments([]);
      setIsSavingDocuments(false);
    }
    setModal(type);
  };
  const selectClientDocument = (event) => {
    const files = Array.from(event.target.files || []);
    // Reset the input so picking the same file again after a removal re-fires
    // the change event instead of being treated as a no-op.
    event.target.value = "";
    if (!files.length) return;
    setDataError("");
    // Keep the File objects and upload them at submit time: reading every file
    // into a data URL on selection would hold the whole payload in memory even
    // if the dialog were cancelled.
    const selected = files.map((file) => ({
      name: file.name,
      type: file.type || "application/octet-stream",
      file,
    }));
    setClientDocuments((current) => [...current, ...selected]);
  };
  const removeClientDocument = (index) => {
    setClientDocuments((current) => current.filter((_, position) => position !== index));
  };
  const submitClient = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("client");
    setIsSavingDocuments(clientDocuments.length > 0);
    const total = Number(clientForm.amount) || 0;
    const received = Number(clientForm.received) || 0;
    setDataError("");
    try {
      const result = await requestApi("clients", "POST", {
        assignedTo: clientForm.assignedTo,
        ...(session.role === "social_media" ? { assignedShift: clientForm.assignedShift } : {}),
        date: clientForm.date,
        workTime: clientForm.workTime,
        name: clientForm.name.trim(),
        provider: clientForm.provider.trim(),
        cell: clientForm.cell.trim(),
        cnic: clientForm.cnic.trim(),
        pin: clientForm.pin.trim(),
        password: clientForm.password,
        email: clientForm.email.trim(),
        work: clientForm.work.trim(),
        description: clientForm.description.trim(),
        // The data layer uploads each File to Storage and stores the download
        // URL; the legacy flat fields are no longer sent from here.
        documents: clientDocuments,
        initials: clientForm.name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
        status: "Pending",
        totalAmount: total,
        totalReceived: received,
        usedFor: clientForm.usedFor.trim(),
        color: "mint",
      });
      setClientForm({ date: new Date().toISOString().slice(0, 10), workTime: new Date().toTimeString().slice(0, 5), name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", assignedTo: "", assignedShift: "", amount: "", received: "", usedFor: "" });
      setClientDocuments([]);
      setModal(null);
      setActiveNav("Clients");
      // The write returns the created client, so the table updates from the
      // response instead of waiting for a second network round-trip.
      if (result?.client) {
        const created = result.client;
        // The table renders from this row the moment the write returns; the
        // background refresh replaces it with the authoritative document.
        setClientRecords((current) => [{
          ...created,
          ...clientForm,
          id: created.id,
          date: created.date || clientForm.date || "-",
          amount: Number(created.amount ?? clientForm.amount) || 0,
          received: Number(created.received ?? clientForm.received) || 0,
          owner: assignableEmployeeRecords.find((employee) => employee.uid === created.assignedTo)?.name || created.owner || session.name,
          assignedToName: assignableEmployeeRecords.find((employee) => employee.uid === created.assignedTo)?.name || created.assignedToName || session.name,
          assignedByName: created.assignedByName || session.name,
          initials: created.initials || clientForm.name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
          color: created.color || "mint",
          workTime: clientForm.workTime,
          workShift: workShiftFromTime(clientForm.workTime),
        }, ...current.filter((record) => record.id !== created.id)]);
      }
      // Everything else (the Overview totals, Excel records, Payments) is
      // revalidated in the background rather than blocking the UI.
      loadSection(firebaseUser, "Clients").catch((error) => setDataError(`Client added, but records could not refresh: ${error.message}`));
    } catch (error) {
      // Temporary diagnostic: shows where in the code the failure actually
      // happened (the SDK frame names and line numbers), so "Cannot read
      // properties of undefined" can be traced to its real call site.
      const stackLine = String(error?.stack || "")
        .split("\n")
        .slice(1, 4)
        .map((line) => line.trim())
        .join(" | ");
      setDataError(`Could not save client to Firebase: ${error.message}\n${stackLine}`);
    } finally {
      submitLock.current = false;
      setIsSavingDocuments(false);
      setSavingAction(null);
    }
  };
  const openClientEdit = (client) => {
    setClientEditForm({
      id: client.id,
      date: client.date || new Date().toISOString().slice(0, 10),
      workTime: client.workTime || "",
      name: client.name || "",
      provider: client.provider || "",
      cell: limitDigits(client.cell || "", 11),
      cnic: limitDigits(client.cnic || "", 13),
      pin: client.pin || "",
      password: client.password || "",
      email: client.email || "",
      work: client.work || "",
      description: client.description || "",
      totalAmount: String(client.amount || 0),
      totalReceived: String(client.received || 0),
      usedFor: client.usedFor || "",
    });
    setModal("edit-client");
  };
  const submitClientEdit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("edit-client");
    setDataError("");
    try {
      await requestApi("clients", "PATCH", { ...clientEditForm, clientId: clientEditForm.id, action: "edit" });
      setModal(null);
      const nextRemote = { ...clientEditForm, id: clientEditForm.id, name: clientEditForm.name, provider: clientEditForm.provider };
      setClientRecords((current) => current.map((record) => {
        if (record.id !== nextRemote.id) return record;
        const totalAmount = Number(nextRemote.totalAmount) || 0;
        const totalReceived = Number(nextRemote.totalReceived) || 0;
        const remaining = Math.max(totalAmount - totalReceived, 0);
        // Mirror the server rule: only a fully paid client is "Received"; any
        // unpaid balance after an edit must immediately show "Pending".
        const payment = remaining === 0 && totalAmount > 0 ? "Received" : "Pending";
        return {
          ...record,
          ...nextRemote,
          amount: totalAmount,
          received: totalReceived,
          remaining,
          payment,
          workShift: workShiftFromTime(nextRemote.workTime),
          status: remaining === 0 && totalAmount > 0
            ? "Completed"
            : ["New", "Pending", "In Progress"].includes(record.status)
              ? "In Progress"
              : record.status,
        };
      }));
      setActiveNav("Clients");
      // force: the record cache is seconds old after a save, so a non-forced
      // refresh would skip the re-read and the row could keep showing the old
      // total amount until the cache expired.
      loadSection(firebaseUser, "Clients", { force: true }).catch((error) => setDataError(`Client saved, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not update client: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const submitEmployee = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("employee");
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name").trim();
    setDataError("");
    try {
      const result = await requestApi("employees", "POST", {
        name,
        email: formData.get("email").trim(),
        phone: formData.get("phone").trim(),
        password: formData.get("password"),
        role: formData.get("role"),
        managerUid: formData.get("managerUid") || undefined,
      });

      if (result?.employee) {
        setEmployeeRecords((current) => [formatEmployee(result.employee), ...current]);
      }

      setModal(null);
      setActiveNav("Employees");
      loadSection(firebaseUser, "Employees", { force: true }).catch((refreshError) => setDataError(`Employee created, but records could not refresh: ${refreshError.message}`));
    } catch (error) {
      setDataError(`Could not save employee to Firebase: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openClientDelete = (client) => {
    setClientToDelete(client);
    setModal("delete-client");
  };
  const openPaymentEdit = (payment) => {
    setPaymentEditForm({
      id: payment.id,
      clientId: payment.clientId,
      amount: String(payment.amount || ""),
      date: payment.date || "",
      usedFor: payment.usedFor || "",
    });
    setModal("edit-payment");
  };
  const openPaymentDelete = (payment) => {
    setPaymentToDelete(payment);
    setModal("delete-payment");
  };
  const submitPaymentEdit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("edit-payment");
    setDataError("");
    try {
      await requestApi("payments", "PATCH", { ...paymentEditForm, paymentId: paymentEditForm.id });
      const amount = Number(paymentEditForm.amount) || 0;
      setPaymentRecords((current) => current.map((record) => (record.id === paymentEditForm.id ? { ...record, amount, date: paymentEditForm.date, usedFor: paymentEditForm.usedFor } : record)));
      setModal(null);
      loadSection(firebaseUser, "Payments", { force: true }).catch((error) => setDataError(`Payment saved, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not edit payment: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const deletePaymentRecord = async () => {
    if (!paymentToDelete || submitLock.current) return;
    submitLock.current = true;
    setSavingAction("delete-payment");
    setDataError("");
    try {
      await requestApi("payments", "DELETE", { paymentId: paymentToDelete.id });
      setPaymentRecords((current) => current.filter((record) => record.id !== paymentToDelete.id));
      setModal(null);
      setPaymentToDelete(null);
      loadSection(firebaseUser, "Payments", { force: true }).catch((error) => setDataError(`Payment deleted, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not delete payment: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openClientView = (client) => {
    setClientToView(client);
  };
  const deleteClient = async () => {
    if (!clientToDelete || submitLock.current) return;
    submitLock.current = true;
    setSavingAction("delete-client");
    setDataError("");
    try {
      await requestApi("clients", "PATCH", { clientId: clientToDelete.id, action: "delete" });
      setClientRecords((current) => current.filter((record) => record.id !== clientToDelete.id));
      setPaymentRecords((current) => current.filter((payment) => payment.clientId !== clientToDelete.id));
      setServiceRecords((current) => current.filter((service) => service.clientId !== clientToDelete.id));
      setModal(null);
      setClientToDelete(null);
      loadSection(firebaseUser, "Clients").catch((error) => setDataError(`Client deleted, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not delete client: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openEmployeeEdit = (employee) => {
    setEmployeeEditForm({ uid: employee.uid, name: employee.name, email: employee.email, phone: employee.phone, role: employee.roleCode, managerUid: employee.managerUid || employee.createdBy || session.uid });
    setModal("edit-employee");
  };
  const openEmployeeDelete = (employee) => {
    setEmployeeToDelete(employee);
    setModal("delete-employee");
  };
  const deleteEmployee = async () => {
    if (!employeeToDelete || submitLock.current) return;
    submitLock.current = true;
    setSavingAction("delete-employee");
    setDataError("");
    try {
      await requestApi("employees", "PATCH", { uid: employeeToDelete.uid, action: "delete" });
      setEmployeeRecords((current) => current.filter((record) => record.uid !== employeeToDelete.uid));
      setAssignableEmployeeRecords((current) => current.filter((record) => record.uid !== employeeToDelete.uid));
      setModal(null);
      setEmployeeToDelete(null);
      loadSection(firebaseUser, "Employees", { force: true }).catch((error) => setDataError(`Employee deleted, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not delete employee: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openEmployeePasswordReset = (employee) => {
    setPasswordResetForm({ uid: employee.uid, password: "", confirmPassword: "" });
    setModal("reset-employee-password");
  };
  const submitEmployeePasswordReset = async (event) => {
    event.preventDefault();
    setDataError("");
    if (passwordResetForm.password.length < 8) {
      setDataError("Could not set employee password: the new password must be at least 8 characters.");
      return;
    }
    if (passwordResetForm.password !== passwordResetForm.confirmPassword) {
      setDataError("Could not set employee password: the password confirmation does not match.");
      return;
    }
    submitLock.current = true;
    setSavingAction("reset-employee-password");
    try {
      const employee = employeeRecords.find(
        (record) => record.uid === passwordResetForm.uid,
      );
      if (!employee) throw new Error("Employee record is unavailable.");
      await requestApi("employees", "PATCH", {
        uid: employee.uid,
        password: passwordResetForm.password,
      });
      setModal(null);
      setPasswordResetForm({ uid: "", password: "", confirmPassword: "" });
      setDataError(`New password saved for ${employee.name}.`);
    } catch (error) {
      setDataError(`Could not set employee password: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const submitEmployeeEdit = async (event) => {
    event.preventDefault();
    setDataError("");
    try {
      const { uid, ...updates } = employeeEditForm;
      delete updates.email;
      await requestApi("employees", "PATCH", { uid, ...updates });
      await loadSection(firebaseUser, "Employees", { force: true });
      setModal(null);
    } catch (error) {
      setDataError(`Could not update employee: ${error.message}`);
    }
  };
  const updateEmployeePermissions = async (uid, permissions) => {
    setDataError("");
    try {
      await requestApi("employees", "PATCH", { uid, permissions });
      await loadSection(firebaseUser, "Employees", { force: true });
    } catch (error) {
      setDataError(`Could not update employee permissions: ${error.message}`);
    }
  };
  const updateClientStatus = async (client, status) => {
    setDataError("");
    try {
      await requestApi("clients", "PATCH", { clientId: client.id, status });
      // Optimistic: the row flips immediately, the write-through cache confirms it.
      setClientRecords((current) => current.map((record) => record.id === client.id ? { ...record, status } : record));
      await loadSection(firebaseUser, "Clients");
    } catch (error) {
      setDataError(`Could not update work status: ${error.message}`);
    }
  };
  const transferClient = async (clientId, assignedTo) => {
    setDataError("");
    try {
      await requestApi("clients", "PATCH", { clientId, assignedTo });
      const owner = assignableEmployeeRecords.find((employee) => employee.uid === assignedTo)?.name || session.name;
      setClientRecords((current) => current.map((record) => record.id === clientId ? { ...record, assignedTo, ...(owner ? { owner, assignedToName: owner, assignedByName: session.name } : {}) } : record));
      await loadSection(firebaseUser, "Clients");
    } catch (error) {
      setDataError(`Could not reassign client: ${error.message}`);
    }
  };
  const submitPayment = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("payment");
    setDataError("");
    try {
      const result = await requestApi("payments", "POST", paymentForm);
      // The write returns the recorded payment, so the table updates from the
      // response and the background refresh only confirms it.
      if (result?.payment) {
        const recorded = result.payment;
        setPaymentRecords((current) => [recorded, ...current.filter((record) => record.id !== recorded.id)]);
        setClientRecords((current) => current.map((record) => {
          if (record.id !== recorded.clientId) return record;
          const totalAmount = Number(record.amount) || 0;
          const totalReceived = (Number(record.received) || 0) + (Number(recorded.amount) || 0);
          const remaining = Math.max(totalAmount - totalReceived, 0);
          return {
            ...record,
            amount: totalAmount,
            received: totalReceived,
            remaining,
            payment: remaining === 0 && totalAmount > 0 ? "Received" : "Pending",
            status: remaining === 0 ? "Completed" : ["New", "Pending", "In Progress"].includes(record.status) ? "In Progress" : record.status,
          };
        }));
      }
      setPaymentForm({ clientId: "", amount: "", date: new Date().toISOString().slice(0, 10), usedFor: "" });
      setModal(null);
      setActiveNav("Payments");
      loadSection(firebaseUser, "Payments").catch((error) => setDataError(`Payment saved, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not record payment: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const submitService = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("service");
    setDataError("");
    try {
      const result = await requestApi("services", "POST", serviceForm);
      // The write returns the created service, so the table updates from the
      // response instead of waiting for the refresh.
      if (result?.service) {
        const created = result.service;
        setServiceRecords((current) => [created, ...current.filter((record) => record.id !== created.id)]);
      }
      setServiceForm({ name: "", category: "" });
      setModal(null);
      setActiveNav("Services");
      loadSection(firebaseUser, "Services").catch((error) => setDataError(`Service saved, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not save service: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };

  if (!session) return null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandLogo /><div><strong>Professional<br />Tax Partner</strong><span>Consultant CRM</span></div></div>
        <div className="workspace-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {visibleNavItems.map(([label, icon]) => <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => setActiveNav(label)}><Icon name={icon} /><span>{label}</span>{label === "Clients" && <b className="nav-count">{scope.clients.length}</b>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button className="nav-item"><Icon name="shield" /><span>Security center</span></button><button className="nav-item"><Icon name="grid" /><span>Settings</span></button><div className="support-card"><div className="support-icon"><Icon name="bell" size={16} /></div><strong>Need a hand?</strong><p>Visit the help center or contact support.</p><button>Open help center <Icon name="arrow" size={14} /></button></div><div className="user-mini"><div className="avatar avatar-teal">{session.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div><strong>{session.name}</strong><span>{session.roleLabel}</span></div><button className="logout-button" onClick={async () => { await signOut(auth); setSession(null); }}>Log out</button></div></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="arrow" size={14} /><strong>{activeNav}</strong></div><div className="top-actions"><div className="secure-tag"><span className="secure-dot" /> Data access: scoped</div>{isRefreshing && <div className="syncing-tag" role="status">Syncing…</div>}<button className="icon-button"><Icon name="bell" /><i /></button><div className="top-avatar">AK</div></div></header>
        <div className="content-wrap">
          {dataError && <div className="empty-state" role="alert">{dataError}</div>}
          <div className="welcome-row">
            <div><p className="eyebrow">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p><h1>{(() => { const hour = new Date().getHours(); const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 20 ? "Good evening" : "Good night"; return `${greeting}, ${session.name.split(" ")[0]}`; })()}</h1><p className="subheading">Here&apos;s what&apos;s happening across your practice today.</p></div>
            <div className="header-actions">
              {canOpenTeamView && <label className="role-select"><span>{session.role === "admin" ? "Admin team view" : "Team view"}</span><select value={teamView} onChange={(event) => { setTeamView(event.target.value); setModal(null); }}><option value="All teams">All teams</option>{teamViewEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
              {canPreviewTeam && teamViewEmployees.length === 0 && <span className="team-view-empty">{emptyTeamNotice(session, dataError, !isLoading)}</span>}
              <div className="role-select role-static"><span>Signed in as</span><strong>{session.roleLabel}</strong></div>
              {canAddClient && !isAdminPreview && <button className="primary-button" onClick={() => openModal("client")}><Icon name="plus" size={17} /> Add client</button>}
            </div>
          </div>
          <LiveOverview clients={scope.clients} isLoading={isLoading} />

          {activeNav === "Overview" ? <>
          <section className="panel clients-panel"><div className="panel-heading clients-heading"><div><h2>Recent clients</h2><p>Stay on top of your latest client activity</p></div><button className="text-button" onClick={() => setActiveNav("Clients")}>View all clients <Icon name="arrow" size={15} /></button></div><div className="table-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients..." /></div><div className="filter-tabs">{["All clients", "In Progress", "Pending", "Completed"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="filter-button">Filter <span>⌄</span></button></div><div className="table-scroll"><table><thead><tr><th>Client</th><th>Service</th><th>Assigned to</th><th>Assigned by</th><th>Work status</th><th>Payment</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>{pagedOverviewClients.map((client) => <tr key={client.id}><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td><div className="owner-cell"><div className="owner-avatar">{client.owner.split(" ").map((word) => word[0]).join("")}</div>{client.owner}</div></td><td>{client.assignedByName || "-"}</td><td><span className={`status-badge ${client.status.toLowerCase().replace(" ", "-")}`}><i />{client.status}</span></td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span><small className="payment-amount">{formatMoney(client.received)} / {formatMoney(client.amount)}</small></td><td className="date-cell"><DateCell date={client.date} client={client} /></td><td><ClientRowActions client={client} canManage={!isAdminPreview && ((client.assignedBy || client.createdBy) === session.uid || session.role === "admin")} onViewClient={openClientView} onEditClient={openClientEdit} onDeleteClient={openClientDelete} /></td></tr>)}</tbody></table>{visibleClients.length === 0 && <div className="empty-state">No authorized clients match this search.</div>}</div><div className="table-footer"><span>Showing <strong>{pagedOverviewClients.length}</strong> of <strong>{visibleClients.length}</strong> authorized clients</span><div className="pagination"><button disabled={currentOverviewPage <= 1} onClick={() => setOverviewPageSafe(currentOverviewPage - 1)}>‹</button>{Array.from({ length: overviewPageCount }, (_, index) => index + 1).map((page) => <button key={page} className={page === currentOverviewPage ? "current" : ""} onClick={() => setOverviewPageSafe(page)}>{page}</button>)}<button disabled={currentOverviewPage >= overviewPageCount} onClick={() => setOverviewPageSafe(currentOverviewPage + 1)}>›</button></div></div></section>
          </> : <WorkspaceView section={activeNav} role={isAdminPreview ? `Preview: ${employeeRecords.find((employee) => employee.uid === teamView)?.name || "Employee"}` : role} clients={scope.clients} employeeRecords={scopedEmployees} assignableEmployees={isAdminPreview ? scopedEmployees : assignableEmployeeRecords} serviceRecords={scopedServices} paymentRecords={scopedPayments} query={query} setQuery={setQuery} onAction={openModal} onClientStatusChange={updateClientStatus} onClientTransfer={transferClient} onViewClient={openClientView} onEditClient={openClientEdit} onDeleteClient={openClientDelete} onEditPayment={openPaymentEdit} onDeletePayment={openPaymentDelete} onEditEmployee={openEmployeeEdit} onDeleteEmployee={openEmployeeDelete} onResetEmployeePassword={openEmployeePasswordReset} onEmployeePermissionsChange={updateEmployeePermissions} currentUid={session.uid} isAdmin={session.role === "admin"} canManageEmployees={canManageEmployees && !isAdminPreview} canManagePermissions={session.permissions.includes("manage_permissions") && !isAdminPreview} canManageServices={canManageServices && !isAdminPreview} canAddClient={canAddClient && !isAdminPreview} employeeRoleOptions={employeeRoleOptions} assignableRoleOptions={assignableRoleOptions} readOnlyPreview={isAdminPreview} />}
        </div>
      </section>
      {clientToView && <ClientDetailsModal client={clientToView} onClose={() => setClientToView(null)} />}
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setClientToDelete(null); setEmployeeToDelete(null); } }}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby={modal === "delete-client" ? "delete-client-description" : modal === "delete-employee" ? "delete-employee-description" : modal === "delete-payment" ? "delete-payment-description" : undefined}>
          <div className="modal-header"><div><p className="eyebrow">{modal === "client" ? "Client assignment" : modal === "delete-client" || modal === "edit-client" ? "Client record" : modal === "payment" ? "Payment entry" : modal === "edit-payment" ? "Payment record" : modal === "service" ? "Service management" : "Team access"}</p><h2 id="modal-title">{modal === "client" ? "Add new client" : modal === "delete-client" ? "Delete client permanently?" : modal === "delete-employee" ? "Delete employee permanently?" : modal === "delete-payment" ? "Delete payment permanently?" : modal === "employee" ? "Add new employee" : modal === "edit-client" ? "Edit client" : modal === "edit-employee" ? "Edit employee" : modal === "reset-employee-password" ? "Reset employee password" : modal === "edit-payment" ? "Edit payment" : modal === "service" ? "Add service" : "Record payment"}</h2></div><button className="modal-close" onClick={() => { setModal(null); setClientToDelete(null); setEmployeeToDelete(null); }} aria-label="Close dialog">&times;</button></div>
          {modal === "client" ? <form onSubmit={submitClient}>
            <div className="form-grid client-form-grid">
              <label>Date<input required type="date" value={clientForm.date} onChange={(event) => setClientForm({ ...clientForm, date: event.target.value })} /></label>
              <label>Work time<input required type="time" value={clientForm.workTime} onChange={(event) => setClientForm({ ...clientForm, workTime: event.target.value })} /><small className="field-hint">{workShiftFromTime(clientForm.workTime) ? `${workShiftFromTime(clientForm.workTime)} shift` : "10:00 AM – 5:00 PM counts as Morning"}</small></label>
              <label>Client name<input required value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} placeholder="e.g. Falcon Traders" /></label>
              <label>Client provider<input required value={clientForm.provider} onChange={(event) => setClientForm({ ...clientForm, provider: event.target.value })} placeholder="e.g. XYZ Provider" /></label>
              <label>Cell<input required type="tel" inputMode="numeric" maxLength={11} pattern="[0-9]{11}" title="Enter exactly 11 digits." value={clientForm.cell} onChange={(event) => setClientForm({ ...clientForm, cell: limitDigits(event.target.value, 11) })} placeholder="11 digits" /></label>
              <label>CNIC<input required type="tel" inputMode="numeric" maxLength={13} pattern="[0-9]{13}" title="Enter exactly 13 digits." value={clientForm.cnic} onChange={(event) => setClientForm({ ...clientForm, cnic: limitDigits(event.target.value, 13) })} placeholder="13 digits" /></label>
              <label>PIN<input required value={clientForm.pin} onChange={(event) => setClientForm({ ...clientForm, pin: event.target.value })} placeholder="Client PIN" /></label>
              <PasswordField label="Password" name="password" value={clientForm.password} onChange={(event) => setClientForm({ ...clientForm, password: event.target.value })} placeholder="Client password" minLength={6} autoComplete="new-password" />
              <label>Email<input required type="email" value={clientForm.email} onChange={(event) => setClientForm({ ...clientForm, email: event.target.value })} placeholder="client@email.com" /></label>
              <label>Work<input required value={clientForm.work} onChange={(event) => setClientForm({ ...clientForm, work: event.target.value })} placeholder="e.g. NTN Registration" /></label>
              {session.role === "social_media" && <label>Assigned at<select required value={clientForm.assignedShift} onChange={(event) => setClientForm({ ...clientForm, assignedShift: event.target.value })}><option value="">Select shift</option><option value="day">Day</option><option value="night">Night</option></select></label>}
              <label className="description-field">Description (optional)<textarea value={clientForm.description} onChange={(event) => setClientForm({ ...clientForm, description: event.target.value })} placeholder="Client requirements or notes" rows={3} /></label>
              <label className="document-field">Add documents (optional)
                <input type="file" multiple onChange={selectClientDocument} />
                <span className="document-file-name">{isSavingDocuments ? "Uploading files..." : clientDocuments.length ? `${clientDocuments.length} file${clientDocuments.length > 1 ? "s" : ""} selected` : "No file selected"}</span>
              </label>
              {clientDocuments.length > 0 && <ul className="document-selection-list">{clientDocuments.map((document, index) => <li key={`${document.name}-${index}`}><Icon name="file" size={13} /><span>{document.name}</span><button type="button" className="document-remove-button" onClick={() => removeClientDocument(index)} aria-label={`Remove ${document.name}`}>&times;</button></li>)}</ul>}
              <label>Assigned employee<select required value={clientForm.assignedTo} onChange={(event) => setClientForm({ ...clientForm, assignedTo: event.target.value })}><option value="">Select employee</option><option value={session.uid}>{session.name} · Myself</option>{assignableEmployeeRecords.filter((employee) => employee.status === "Active" && assignableRoleOptions.some((allowedRole) => roleNames[allowedRole] === employee.role)).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>
              <label>Total amount<input required type="number" min="0" value={clientForm.amount} onChange={(event) => setClientForm({ ...clientForm, amount: event.target.value })} placeholder="100000" /></label>
              <label>Received amount<input type="number" min="0" value={clientForm.received} onChange={(event) => setClientForm({ ...clientForm, received: event.target.value })} placeholder="0" /></label>
              <label>Payment At: (optional)<input value={clientForm.usedFor} onChange={(event) => setClientForm({ ...clientForm, usedFor: event.target.value })} placeholder="e.g. Easypaisa" /></label>
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> Remaining amount is calculated automatically. Client access will be scoped to the assigned employee.</p>
            {dataError && <p className="auth-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "client" ? "Saving..." : "Create client"}</button></div>
          </form> : modal === "edit-client" ? <form onSubmit={submitClientEdit}>
            <div className="form-grid client-form-grid">
              <label>Date<input required type="date" value={clientEditForm.date} onChange={(event) => setClientEditForm({ ...clientEditForm, date: event.target.value })} /></label>
              <label>Work time<input required type="time" value={clientEditForm.workTime} onChange={(event) => setClientEditForm({ ...clientEditForm, workTime: event.target.value })} /><small className="field-hint">{workShiftFromTime(clientEditForm.workTime) ? `${workShiftFromTime(clientEditForm.workTime)} shift` : "10:00 AM – 5:00 PM counts as Morning"}</small></label>
              <label>Client name<input required value={clientEditForm.name} onChange={(event) => setClientEditForm({ ...clientEditForm, name: event.target.value })} /></label>
              <label>Client provider<input required value={clientEditForm.provider} onChange={(event) => setClientEditForm({ ...clientEditForm, provider: event.target.value })} /></label>
              <label>Cell<input required type="tel" inputMode="numeric" maxLength={11} pattern="[0-9]{11}" title="Enter exactly 11 digits." value={clientEditForm.cell} onChange={(event) => setClientEditForm({ ...clientEditForm, cell: limitDigits(event.target.value, 11) })} /></label>
              <label>CNIC<input required type="tel" inputMode="numeric" maxLength={13} pattern="[0-9]{13}" title="Enter exactly 13 digits." value={clientEditForm.cnic} onChange={(event) => setClientEditForm({ ...clientEditForm, cnic: limitDigits(event.target.value, 13) })} /></label>
              <label>PIN<input value={clientEditForm.pin} onChange={(event) => setClientEditForm({ ...clientEditForm, pin: event.target.value })} /></label>
              <PasswordField label="Client password" name="client-password" value={clientEditForm.password} onChange={(event) => setClientEditForm({ ...clientEditForm, password: event.target.value })} minLength={0} required={false} />
              <label>Email<input type="email" value={clientEditForm.email} onChange={(event) => setClientEditForm({ ...clientEditForm, email: event.target.value })} /></label>
              <label>Work<input value={clientEditForm.work} onChange={(event) => setClientEditForm({ ...clientEditForm, work: event.target.value })} /></label>
              <label>Total amount<input required type="number" min="0" value={clientEditForm.totalAmount} onChange={(event) => setClientEditForm({ ...clientEditForm, totalAmount: event.target.value })} /></label>
              <label>Received amount<input required type="number" min="0" value={clientEditForm.totalReceived} onChange={(event) => setClientEditForm({ ...clientEditForm, totalReceived: event.target.value })} /></label>
              <label>Payment At (optional)<input value={clientEditForm.usedFor} onChange={(event) => setClientEditForm({ ...clientEditForm, usedFor: event.target.value })} placeholder="e.g. Easypaisa" /></label>
              <label className="description-field">Description (optional)<textarea value={clientEditForm.description} onChange={(event) => setClientEditForm({ ...clientEditForm, description: event.target.value })} rows={3} /></label>
            </div>
            {dataError && <p className="form-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "edit-client" ? "Saving..." : "Save changes"}</button></div>
          </form> : modal === "delete-client" ? <div>
            <p id="delete-client-description" className="form-note delete-warning">This will permanently delete <strong>{clientToDelete?.name}</strong>, all its payment records, and linked services. This action cannot be undone.</p>
            {dataError && <p className="form-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={savingAction !== null} onClick={() => { setModal(null); setClientToDelete(null); }}>Cancel</button><button type="button" className="danger-button" disabled={savingAction !== null} onClick={deleteClient}>{savingAction === "delete-client" ? "Deleting..." : "Delete permanently"}</button></div>
          </div> : modal === "delete-employee" ? <div>
            <p id="delete-employee-description" className="form-note delete-warning">This will <strong>permanently delete {employeeToDelete?.name}</strong> from the employee directory. This action cannot be undone. If any clients are still assigned to this employee, reassign them first.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={savingAction !== null} onClick={() => { setModal(null); setEmployeeToDelete(null); }}>Cancel</button><button type="button" className="danger-button" disabled={savingAction !== null} onClick={deleteEmployee}>{savingAction === "delete-employee" ? "Deleting..." : "Delete permanently"}</button></div>
          </div> : modal === "employee" ? <form onSubmit={submitEmployee}>
            <div className="form-grid">
              <label>Full name<input name="name" required placeholder="e.g. Hira Malik" /></label>
              <label>Email<input name="email" required type="email" placeholder="name@ptpconsultant.pk" /></label>
              <label>Phone<input name="phone" required type="tel" placeholder="03XX-XXXXXXX" /></label>
              <label>Role<select name="role" required value={newEmployeeRole} onChange={(event) => setNewEmployeeRole(event.target.value)}> <option value="" disabled>Select role</option>{employeeRoleOptions.map((employeeRole) => <option key={employeeRole} value={employeeRole}>{roleNames[employeeRole]}</option>)}</select></label>
              {session.role === "admin" && <label>Reports to<select name="managerUid" required defaultValue=""><option value="" disabled>Select manager</option><option value={session.uid}>Admin · {session.name}</option>{employeeRecords.filter((employee) => isRoleBelow(employee.roleCode, newEmployeeRole)).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
              <PasswordField label="Temporary password" name="password" minLength={8} autoComplete="new-password" required />
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> The employee can sign in through the common login page.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "employee" ? "Saving..." : "Create employee"}</button></div>
          </form> : modal === "reset-employee-password" ? <form onSubmit={submitEmployeePasswordReset}>
            <p className="form-note"><Icon name="shield" size={14} /> Set a new login password for this employee. No reset email is sent — the employee signs in with the password you enter here.</p>
            <div className="form-grid">
              <PasswordField label="New password" name="password" value={passwordResetForm.password} onChange={(event) => setPasswordResetForm({ ...passwordResetForm, password: event.target.value })} placeholder="At least 8 characters" autoComplete="new-password" />
              <PasswordField label="Confirm new password" name="confirmPassword" value={passwordResetForm.confirmPassword} onChange={(event) => setPasswordResetForm({ ...passwordResetForm, confirmPassword: event.target.value })} placeholder="Re-enter the new password" autoComplete="new-password" />
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "reset-employee-password" ? "Saving..." : "Save password"}</button></div>
          </form> : modal === "edit-employee" ? <form onSubmit={submitEmployeeEdit}>
            <div className="form-grid">
              <label>Full name<input required value={employeeEditForm.name} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, name: event.target.value })} /></label>
              <label>Email<input type="email" value={employeeEditForm.email} disabled /></label>
              <label>Phone<input required type="tel" value={employeeEditForm.phone} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, phone: event.target.value })} /></label>
              <label>Role<select required value={employeeEditForm.role} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, role: event.target.value })}>{employeeRoleOptions.map((employeeRole) => <option key={employeeRole} value={employeeRole}>{roleNames[employeeRole]}</option>)}</select></label>
              {session.role === "admin" && <label>Reports to<select required value={employeeEditForm.managerUid} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, managerUid: event.target.value })}><option value={session.uid}>Admin · {session.name}</option>{employeeRecords.filter((employee) => employee.uid !== employeeEditForm.uid && isRoleBelow(employee.roleCode, employeeEditForm.role)).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
            </div>
            <p className="form-note">Employee login email is managed by Firebase Authentication and cannot be changed from another account.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button">Save employee</button></div>
          </form> : modal === "edit-payment" ? <form onSubmit={submitPaymentEdit}>
            <div className="form-grid">
              <label>Amount received<input required type="number" min="0.01" step="0.01" value={paymentEditForm.amount} onChange={(event) => setPaymentEditForm({ ...paymentEditForm, amount: event.target.value })} /></label>
              <label>Payment date<input required type="date" value={paymentEditForm.date} onChange={(event) => setPaymentEditForm({ ...paymentEditForm, date: event.target.value })} /></label>
              <label>Payment At:<input required value={paymentEditForm.usedFor} onChange={(event) => setPaymentEditForm({ ...paymentEditForm, usedFor: event.target.value })} /></label>
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> The client&apos;s received and remaining amounts update automatically.</p>
            {dataError && <p className="form-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "edit-payment" ? "Saving..." : "Save changes"}</button></div>
          </form> : modal === "delete-payment" ? <div>
            <p id="delete-payment-description" className="form-note delete-warning">This will permanently delete this payment of <strong>{formatMoney(Number(paymentToDelete?.amount) || 0)}</strong> for <strong>{paymentToDelete?.clientName}</strong>, and the client&apos;s received amount will be reduced by the same value. This action cannot be undone.</p>
            {dataError && <p className="form-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={savingAction !== null} onClick={() => { setModal(null); setPaymentToDelete(null); }}>Cancel</button><button type="button" className="danger-button" disabled={savingAction !== null} onClick={deletePaymentRecord}>{savingAction === "delete-payment" ? "Deleting..." : "Delete permanently"}</button></div>
          </div> : modal === "service" ? <form onSubmit={submitService}>
            <div className="form-grid">
              <label>Service name<input required value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} /></label>
              <label>Category<input required value={serviceForm.category} onChange={(event) => setServiceForm({ ...serviceForm, category: event.target.value })} /></label>
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "service" ? "Saving..." : "Save service"}</button></div>
          </form> : <form onSubmit={submitPayment}>
            <div className="form-grid">
              <label>Client<select required value={paymentForm.clientId} onChange={(event) => setPaymentForm({ ...paymentForm, clientId: event.target.value })}><option value="">Select client</option>{scope.clients.filter((client) => client.amount > client.received).map((client) => <option key={client.id} value={client.id}>{client.name} · remaining {formatMoney(client.amount - client.received)}</option>)}</select></label>
              <label>Amount received<input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label>
              <label>Payment date<input required type="date" value={paymentForm.date} onChange={(event) => setPaymentForm({ ...paymentForm, date: event.target.value })} /></label>
              <label>Payment At:<input required value={paymentForm.usedFor} onChange={(event) => setPaymentForm({ ...paymentForm, usedFor: event.target.value })} placeholder="ee" /></label>
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> Partial and multiple payments update the remaining balance automatically.</p>
            {/* The page-level alert sits behind this dialog, so a failed save would
                otherwise look like nothing happened. Surface it here too. */}
            {dataError && <p className="form-error" role="alert">{dataError}</p>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "payment" ? "Saving..." : "Save payment"}</button></div>
          </form>}
        </div>
      </div>}
    </main>
  );
}

export default function Home() {
  redirect("/login");
}