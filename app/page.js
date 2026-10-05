"use client";

import { redirect } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import BrandLogo from "./brand-logo";

const navItems = [
  ["Overview", "grid"], ["Clients", "users"], ["Employees", "briefcase"], ["Services", "layers"], ["Payments", "wallet"], ["Reports", "chart"], ["Excel records", "file"],
];

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

function ClientRowActions({ client, canManage, onEditClient, onDeleteClient }) {
  if (!canManage) return null;

  return <div className="client-row-actions">
    <button type="button" className="text-button" onClick={() => onEditClient(client)}>Edit</button>
    <button type="button" className="client-delete-button" onClick={() => onDeleteClient(client)}>Delete</button>
  </div>;
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
      <article><span>Total received</span><strong>{formatMoney(totalReceived)}</strong></article>
      <article><span>Outstanding</span><strong>{formatMoney(outstanding)}</strong></article>
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

function downloadExcelRecords(records) {
  const headers = ["S.NO", "Date", "Client Name", "Client Provider", "Cell", "CNIC", "PIN", "Password", "Email", "Work", "Description", "Total Amount", "Received Amount", "Remaining Amount", "Payment Status"];
  const rows = records.map((client, index) => [index + 1, client.date || "", client.name, client.provider, client.cell || "", client.cnic || "", client.pin || "", client.password || "", client.email || "", client.work || client.provider, client.description || "", client.amount || 0, client.received || 0, Math.max((client.amount || 0) - (client.received || 0), 0), client.payment || "Pending"]);
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `PTP-completed-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });

  const submitAuth = (event) => {
    event.preventDefault();
    setError("");
    const email = form.email.trim().toLowerCase();
    if (mode === "signup" && form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (mode === "login" && email !== "admin@ptpconsultant.pk" && !window.localStorage.getItem(`ptp-admin-${email}`)) {
      setError("Only an authorized Admin account can access this workspace.");
      return;
    }
    if (mode === "login" && form.password.length < 6) {
      setError("Enter a valid password with at least 6 characters.");
      return;
    }
    if (mode === "signup") {
      window.localStorage.setItem(`ptp-admin-${email}`, JSON.stringify({ name: form.name, password: form.password, role: "Admin" }));
    }
    window.localStorage.setItem("ptp-session", JSON.stringify({ name: form.name || "Adnan Khan", email, role: "Admin" }));
    onAuthenticated({ name: form.name || "Adnan Khan", email, role: "Admin" });
  };

  return <main className="auth-shell"><section className="auth-visual"><div className="auth-brand"><BrandLogo /><span>Professional Tax Partner</span></div><div className="auth-visual-content"><p className="eyebrow">Private operations workspace</p><h1>Clarity for every<br /><em>client decision.</em></h1><p>One secure place to manage tax work, assignments, payments, and your team.</p><div className="auth-proof"><div className="proof-avatars"><span>AK</span><span>MS</span><span>SA</span><b>+12</b></div><div><strong>Trusted by your team</strong><small>Secure role-based access</small></div></div></div><div className="auth-visual-footer"><span>© 2026 Professional Tax Partner</span><span><i /> Systems operational</span></div></section><section className="auth-panel"><div className="auth-card"><div className="mobile-auth-brand"><BrandLogo /><strong>Professional Tax Partner</strong></div><div className="auth-heading"><span className="auth-kicker">ADMIN ACCESS ONLY</span><h2>{mode === "login" ? "Welcome back" : "Create admin account"}</h2><p>{mode === "login" ? "Sign in to manage your consultancy workspace." : "Set up the administrator account for your workspace."}</p></div><div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button></div><form className="auth-form" onSubmit={submitAuth}>{mode === "signup" && <label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Adnan Khan" /></label>}<label>Admin email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="admin@ptpconsultant.pk" /></label><label>Password<input required type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" /></label>{mode === "signup" && <label>Confirm password<input required type="password" minLength={6} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} placeholder="Repeat your password" /></label>}{error && <div className="auth-error">{error}</div>}<button type="submit" className="auth-submit">{mode === "login" ? "Sign in to workspace" : "Create admin account"}<Icon name="arrow" size={16} /></button></form><div className="auth-security"><Icon name="shield" size={16} /><span><strong>Admin-only workspace</strong><small>Employee accounts are created from inside the Admin portal.</small></span></div>{mode === "login" && <p className="demo-login">Demo: <strong>admin@ptpconsultant.pk</strong> / <strong>Admin@123</strong></p>}</div></section></main>;
}

function WorkspaceView({ section, role, clients, employeeRecords, serviceRecords, paymentRecords, query, setQuery, onAction, onClientStatusChange, onClientTransfer, onEditClient, onDeleteClient, onEmployeeStatusChange, onEditEmployee, onResetEmployeePassword, onEmployeePermissionsChange, currentUid, canManageEmployees, canManagePermissions, canManageServices, canAddClient, employeeRoleOptions, readOnlyPreview, isAdmin }) {
  const sectionMeta = {
    Clients: { title: "Clients", subtitle: "Only clients available to your current role are shown.", action: "Add client" },
    Employees: { title: "Employees", subtitle: "Manage team access and assigned workload.", action: "Add employee" },
    Services: { title: "Services", subtitle: "Your practice services and their active client assignments.", action: "Add service" },
    Payments: { title: "Payments", subtitle: "Track received installments and outstanding balances.", action: "Record payment" },
    Reports: { title: "Reports", subtitle: "Operational reports generated from authorized records.", action: "Export report" },
    "Excel records": { title: "Excel records", subtitle: "Completed records available within your permission scope.", action: "Download Excel" },
  };
  const meta = sectionMeta[section] || sectionMeta.Clients;
  const [permissionEmployeeUid, setPermissionEmployeeUid] = useState("");
  const [permissionDrafts, setPermissionDrafts] = useState([]);
  const normalizedQuery = query.toLowerCase();
  const scopedEmployees = employeeRecords;
  const matchingClients = clients.filter((client) => `${client.name} ${client.provider} ${client.owner}`.toLowerCase().includes(normalizedQuery));
  const filteredClients = section === "Excel records"
    ? matchingClients.filter((client) => client.status === "Completed")
    : section === "Clients"
      ? matchingClients.filter((client) => client.status !== "Completed")
      : matchingClients;
  const filteredEmployees = scopedEmployees.filter((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(normalizedQuery));
  const filteredServices = serviceRecords.filter((service) => `${service.name} ${service.category}`.toLowerCase().includes(normalizedQuery));
  const filteredPayments = paymentRecords.filter((payment) => `${payment.clientName} ${payment.date}`.toLowerCase().includes(normalizedQuery));
  const roleNames = { sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" };
  const assignableEmployees = employeeRecords.filter((employee) => employee.status === "Active" && employeeRoleOptions.some((employeeRole) => roleNames[employeeRole] === employee.role));
  const showAction = !readOnlyPreview && ((section === "Employees" && canManageEmployees) || (section === "Clients" && canAddClient) || (section === "Services" && canManageServices) || (section === "Payments" && clients.length > 0));

  return <section className="workspace-view">
    <div className="workspace-header"><div><p className="eyebrow">{role} workspace</p><h2>{meta.title}</h2><p>{meta.subtitle}</p></div>{section === "Excel records" ? <button className="primary-button" onClick={() => downloadExcelRecords(filteredClients)}><Icon name="file" size={16} /> {meta.action}</button> : showAction && <button className="primary-button" onClick={() => onAction(section === "Employees" ? "employee" : section === "Clients" ? "client" : section === "Services" ? "service" : "payment")}><Icon name="plus" size={17} /> {meta.action}</button>}</div>
    <div className="workspace-summary"><div className="summary-tile"><span>Visible records</span><strong>{section === "Employees" ? filteredEmployees.length : section === "Services" ? filteredServices.length : section === "Payments" ? filteredPayments.length : filteredClients.length}</strong><small>Scoped to your access</small></div><div className="summary-tile"><span>Active {section.toLowerCase()}</span><strong>{section === "Employees" ? filteredEmployees.filter((item) => item.status === "Active").length : section === "Services" ? filteredServices.filter((item) => item.status === "Active").length : section === "Payments" ? filteredPayments.length : filteredClients.filter((item) => item.status !== "Completed").length}</strong><small>Currently in progress</small></div><div className="summary-tile"><span>Role scope</span><strong className="scope-value">{role}</strong><small><span className="secure-dot" /> Protected view</small></div></div>
    <div className="panel workspace-panel"><div className="workspace-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${section.toLowerCase()}...`} /></div><button className="filter-button">Filter <span>⌄</span></button></div>
      {section === "Clients" && !readOnlyPreview && filteredClients.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); const client = clients.find((item) => item.id === formData.get("clientId")); if (client) onClientStatusChange(client, formData.get("status")); }}><label>Client work status<select name="clientId" required defaultValue="">{filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.work || client.provider}</option>)}</select></label><label>Status<select name="status" defaultValue="Pending">{["New", "Pending", "In Progress", "Completed", "Cancelled"].map((status) => <option key={status}>{status}</option>)}</select></label><div className="modal-actions"><button className="primary-button">Update work status</button></div></form>}
      {section === "Clients" && !readOnlyPreview && assignableEmployees.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); onClientTransfer(formData.get("clientId"), formData.get("assignedTo")); }}><label>Client to reassign<select name="clientId" required defaultValue="">{filteredClients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.owner}</option>)}</select></label><label>New assignee<select name="assignedTo" required defaultValue="">{assignableEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label><div className="modal-actions"><button className="primary-button">Reassign client</button></div></form>}
      {section === "Employees" && <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Role</th><th>Assigned clients</th><th>Account status</th><th>Created by</th>{!readOnlyPreview && <th>Actions</th>}</tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.uid}><td><div className="client-cell"><div className="client-avatar mint">{employee.initials}</div><div><strong>{employee.name}</strong><span>{employee.email}</span></div></div></td><td>{employee.role}</td><td>{clients.filter((client) => client.assignedTo === employee.uid).length} clients</td><td><span className={`status-badge ${employee.status === "Active" ? "completed" : "pending"}`}><i />{employee.status}</span></td><td>{employee.createdBy === currentUid ? "You" : employee.createdBy}</td>{!readOnlyPreview && <td><button className="text-button" onClick={() => onEditEmployee(employee)}>Edit</button><button className="text-button" onClick={() => onResetEmployeePassword(employee)}>Reset password</button><button className="secondary-button" onClick={() => onEmployeeStatusChange(employee, employee.status === "Active" ? "inactive" : "active")}>{employee.status === "Active" ? "Deactivate" : "Activate"}</button></td>}</tr>)}</tbody></table></div>}
      {section === "Employees" && !readOnlyPreview && canManagePermissions && filteredEmployees.length > 0 && <form className="form-grid employee-form" onSubmit={(event) => { event.preventDefault(); onEmployeePermissionsChange(permissionEmployeeUid, permissionDrafts); }}>
        <label>Employee permissions<select required value={permissionEmployeeUid} onChange={(event) => { const employee = filteredEmployees.find((item) => item.uid === event.target.value); setPermissionEmployeeUid(event.target.value); setPermissionDrafts(employee?.permissions || []); }}><option value="">Choose employee</option>{filteredEmployees.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name}</option>)}</select></label>
        <div className="permission-checkboxes">{["manage_employees", "manage_permissions", "manage_lower_employees", "manage_junior_employees", "manage_clients", "manage_assignments"].map((permission) => <label key={permission}><input type="checkbox" checked={permissionDrafts.includes(permission)} onChange={(event) => setPermissionDrafts((current) => event.target.checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission))} />{permission.replaceAll("_", " ")}</label>)}</div>
        <div className="modal-actions"><button className="primary-button" disabled={!permissionEmployeeUid}>Save permissions</button></div>
      </form>}
      {section === "Clients" && <div className="table-scroll"><table className="client-record-table"><thead><tr><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Description</th><th>Pending</th><th>Received</th><th>Actions</th></tr></thead><tbody>{filteredClients.map((client) => <tr key={client.id}><td className="date-cell">{client.date || "29 Sep 2026"}</td><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password ? "••••••" : "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td title={client.description || ""}>{client.description || "-"}</td><td className="money-cell">{formatMoney(Math.max(client.amount - client.received, 0))}</td><td className="money-cell">{formatMoney(client.received)}</td><td><ClientRowActions client={client} canManage={!readOnlyPreview && (isAdmin || (client.assignedBy || client.createdBy) === currentUid)} onEditClient={onEditClient} onDeleteClient={onDeleteClient} /></td></tr>)}</tbody></table></div>}
      {section === "Services" && <div className="table-scroll"><table><thead><tr><th>Service</th><th>Category</th><th>Active clients</th><th>Collected</th><th>Status</th><th /></tr></thead><tbody>{filteredServices.map((service) => <tr key={service.id || service.name}><td><div className="service-cell"><div className="service-icon"><Icon name="layers" size={15} /></div><strong>{service.name}</strong></div></td><td>{service.category}</td><td>{service.clients}</td><td className="money-cell">{typeof service.amount === "number" ? formatMoney(service.amount) : service.amount}</td><td><span className="status-badge completed"><i />{service.status}</span></td><td><button className="row-more">•••</button></td></tr>)}</tbody></table></div>}
      {section === "Excel records" && <div className="table-scroll"><table className="excel-record-table"><thead><tr><th>S.NO</th><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Description</th><th>Total Amount</th><th>Received Amount</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{filteredClients.map((client, index) => <tr key={client.id}><td>{index + 1}</td><td>{client.date || "29 Sep 2026"}</td><td><strong>{client.name}</strong><span className="record-id">{client.id}</span></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password ? "••••••" : "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td>{client.description || "-"}</td><td>{formatMoney(client.amount)}</td><td className="money-cell">{formatMoney(client.received)}</td><td className="money-cell">{formatMoney(Math.max(client.amount - client.received, 0))}</td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span></td></tr>)}</tbody></table></div>}
      {section === "Payments" && <div className="table-scroll"><table><thead><tr><th>Client</th><th>Payment date</th><th>Amount received</th><th>Recorded by</th></tr></thead><tbody>{filteredPayments.map((payment) => <tr key={payment.id}><td>{payment.clientName}</td><td>{payment.date}</td><td className="money-cell">{formatMoney(Number(payment.amount) || 0)}</td><td>{payment.recordedByName && payment.recordedByName !== payment.recordedBy ? payment.recordedByName : "Unknown user"}</td></tr>)}</tbody></table>{filteredPayments.length === 0 && <div className="empty-state">No authorized payment records yet.</div>}</div>}
      {section === "Reports" && <div className="empty-workspace"><div className="workspace-icon"><Icon name="chart" size={24} /></div><h3>Authorized operations report</h3><p>{filteredClients.length} clients · {filteredPayments.length} payments · {formatMoney(filteredPayments.reduce((total, payment) => total + (Number(payment.amount) || 0), 0))} received.</p><button className="text-button" onClick={() => downloadExcelRecords(filteredClients)}><Icon name="file" size={15} /> Export report</button></div>}
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
  const [activeNav, setActiveNav] = useState("Overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All clients");
  const [clientRecords, setClientRecords] = useState([]);
  const [employeeRecords, setEmployeeRecords] = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [modal, setModal] = useState(null);
  const [clientToDelete, setClientToDelete] = useState(null);
  const [savingAction, setSavingAction] = useState(null);
  const submitLock = useRef(false);
  const [clientForm, setClientForm] = useState({ date: new Date().toISOString().slice(0, 10), name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", assignedTo: "", amount: "", received: "" });
  const [clientEditForm, setClientEditForm] = useState({ id: "", date: "", name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", totalAmount: "", totalReceived: "" });
  const [paymentForm, setPaymentForm] = useState({ clientId: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const [serviceForm, setServiceForm] = useState({ name: "", category: "" });
  const [employeeEditForm, setEmployeeEditForm] = useState({ uid: "", name: "", email: "", phone: "", role: "" });
  const [newEmployeeRole, setNewEmployeeRole] = useState("");
  const [passwordResetForm, setPasswordResetForm] = useState({ uid: "", password: "" });
  const employeeRoleOptions = ({
    admin: ["sub_admin", "senior_technical", "jn_technical"],
    sub_admin: ["senior_technical", "jn_technical"],
    senior_technical: ["jn_technical"],
    jn_technical: [],
  })[session.role] || [];
  const employeePermission = ({ admin: "manage_employees", sub_admin: "manage_lower_employees", senior_technical: "manage_junior_employees" })[session.role];
  const canManageEmployees = employeeRoleOptions.length > 0 && session.permissions.includes(employeePermission);
  const canManageServices = session.permissions.includes("manage_clients");
  const canAddClient = employeeRoleOptions.length > 0 && session.permissions.includes("manage_assignments");
  const visibleNavItems = navItems.filter(([label]) => {
    if (label === "Employees") return canManageEmployees || session.permissions.includes("manage_assignments");
    if (session.role === "jn_technical") return ["Overview", "Clients", "Services", "Payments", "Excel records"].includes(label);
    return true;
  });

  const requestApi = useCallback(async (path, method = "GET", body, user = firebaseUser) => {
    if (!user) throw new Error("Your Firebase sign-in is not ready. Please sign in again.");
    const token = await user.getIdToken();
    let response;
    try {
      response = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error(`${path} timed out after 15 seconds. Check Firebase Admin deployment credentials and Firestore access.`);
      }
      throw error;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Firebase request failed.");
    return result;
  }, [firebaseUser]);

  const refreshRecords = useCallback(async (user, section) => {
    try {
      const sectionData = {
        Overview: session.role === "admin" ? ["clients", "employees"] : ["clients"],
        Clients: ["clients", "employees"],
        Employees: ["clients", "employees"],
        Services: ["services"],
        Payments: ["clients", "payments"],
        Reports: ["clients", "payments"],
        "Excel records": ["clients"],
      };
      const endpoints = {
        clients: "/api/clients",
        employees: "/api/employees",
        services: "/api/services",
        payments: "/api/payments",
      };
      const canViewEmployees = ["manage_employees", "manage_lower_employees", "manage_junior_employees", "manage_assignments"]
        .some((permission) => session.permissions.includes(permission));
      const requestedData = (sectionData[section] || ["clients"])
        .filter((key) => key !== "employees" || canViewEmployees);
      const settledResults = await Promise.allSettled(requestedData.map((key) => requestApi(endpoints[key], "GET", undefined, user)));
      const results = Object.fromEntries(settledResults.map((result, index) => [
        requestedData[index],
        result.status === "fulfilled" ? result.value : null,
      ]));
      const failures = settledResults.flatMap((result, index) => result.status === "rejected"
        ? [`${requestedData[index]}: ${result.reason?.message || "Unknown error"}`]
        : []);
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
          payment: client.paymentStatus || client.payment || "Pending",
        })).sort((first, second) => String(second.date || "").localeCompare(String(first.date || ""))));
      }
      if (employeeResult) {
        setEmployeeRecords(employeeResult.employees.map((employee) => ({
          ...employee,
          roleCode: employee.role,
          role: ({ sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" })[employee.role] || employee.role,
          status: employee.status === "active" ? "Active" : "Inactive",
          initials: employee.name?.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "",
        })));
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
    }
  }, [requestApi, session.permissions, session.role]);

  useEffect(() => {
    return onAuthStateChanged(auth, setFirebaseUser);
  }, []);
  useEffect(() => {
    if (!firebaseUser) return;
    refreshRecords(firebaseUser, activeNav)
      .catch((error) => setDataError(`Could not load authorized ${activeNav.toLowerCase()} records: ${error.message}`));
  }, [firebaseUser, activeNav, refreshRecords]);
  const previewEmployeeUids = useMemo(() => {
    if (session.role !== "admin" || teamView === "All teams") return null;
    const selectedEmployee = employeeRecords.find((employee) => employee.uid === teamView);
    if (!selectedEmployee) return new Set();

    const visibleUids = new Set([selectedEmployee.uid]);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const employee of employeeRecords) {
        if (visibleUids.has(employee.managerUid || employee.createdBy) && !visibleUids.has(employee.uid)) {
          visibleUids.add(employee.uid);
          foundDescendant = true;
        }
      }
    }
    return visibleUids;
  }, [employeeRecords, session.role, teamView]);
  const isAdminPreview = session.role === "admin" && teamView !== "All teams";
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

  const openModal = (type) => setModal(type);
  const submitClient = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSavingAction("client");
    const total = Number(clientForm.amount) || 0;
    const received = Number(clientForm.received) || 0;
    setDataError("");
    try {
      await requestApi("/api/clients", "POST", {
        assignedTo: clientForm.assignedTo,
        date: clientForm.date,
        name: clientForm.name.trim(),
        provider: clientForm.provider.trim(),
        cell: clientForm.cell.trim(),
        cnic: clientForm.cnic.trim(),
        pin: clientForm.pin.trim(),
        password: clientForm.password,
        email: clientForm.email.trim(),
        work: clientForm.work.trim(),
        description: clientForm.description.trim(),
        initials: clientForm.name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
        status: "Pending",
        totalAmount: total,
        totalReceived: received,
        color: "mint",
      });
      setClientForm({ date: new Date().toISOString().slice(0, 10), name: "", provider: "", cell: "", cnic: "", pin: "", password: "", email: "", work: "", description: "", assignedTo: "", amount: "", received: "" });
      setModal(null);
      setActiveNav("Clients");
      if (activeNav === "Clients") {
        refreshRecords(firebaseUser, "Clients").catch((error) => setDataError(`Client added, but records could not refresh: ${error.message}`));
      }
    } catch (error) {
      setDataError(`Could not save client to Firebase: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openClientEdit = (client) => {
    setClientEditForm({
      id: client.id,
      date: client.date || new Date().toISOString().slice(0, 10),
      name: client.name || "",
      provider: client.provider || "",
      cell: client.cell || "",
      cnic: client.cnic || "",
      pin: client.pin || "",
      password: client.password || "",
      email: client.email || "",
      work: client.work || "",
      description: client.description || "",
      totalAmount: String(client.amount || 0),
      totalReceived: String(client.received || 0),
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
      await requestApi("/api/clients", "PATCH", { ...clientEditForm, clientId: clientEditForm.id, action: "edit" });
      setModal(null);
      setActiveNav("Clients");
      refreshRecords(firebaseUser, "Clients").catch((error) => setDataError(`Client saved, but records could not refresh: ${error.message}`));
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
      const result = await requestApi("/api/employees", "POST", {
        name,
        email: formData.get("email").trim(),
        phone: formData.get("phone").trim(),
        password: formData.get("password"),
        role: formData.get("role"),
        managerUid: formData.get("managerUid") || undefined,
      });

      if (result?.employee) {
        setEmployeeRecords((current) => [{
          ...result.employee,
          roleCode: result.employee.role,
          role: ({ sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" })[result.employee.role] || result.employee.role,
          status: result.employee.status === "active" ? "Active" : "Inactive",
          initials: name?.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "",
        }, ...current]);
      }

      setModal(null);
      setActiveNav("Employees");
      if (activeNav === "Employees") {
        refreshRecords(firebaseUser, "Employees").catch((refreshError) => setDataError(`Employee created, but records could not refresh: ${refreshError.message}`));
      }
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
  const deleteClient = async () => {
    if (!clientToDelete || submitLock.current) return;
    submitLock.current = true;
    setSavingAction("delete-client");
    setDataError("");
    try {
      await requestApi("/api/clients", "PATCH", { clientId: clientToDelete.id, action: "delete" });
      setClientRecords((current) => current.filter((record) => record.id !== clientToDelete.id));
      setPaymentRecords((current) => current.filter((payment) => payment.clientId !== clientToDelete.id));
      setServiceRecords((current) => current.filter((service) => service.clientId !== clientToDelete.id));
      setModal(null);
      setClientToDelete(null);
      refreshRecords(firebaseUser, activeNav).catch((error) => setDataError(`Client deleted, but records could not refresh: ${error.message}`));
    } catch (error) {
      setDataError(`Could not delete client: ${error.message}`);
    } finally {
      submitLock.current = false;
      setSavingAction(null);
    }
  };
  const openEmployeeEdit = (employee) => {
    setEmployeeEditForm({ uid: employee.uid, name: employee.name, email: employee.email, phone: employee.phone, role: employee.roleCode, managerUid: employee.createdBy || session.uid });
    setModal("edit-employee");
  };
  const openEmployeePasswordReset = (employee) => {
    setPasswordResetForm({ uid: employee.uid, password: "" });
    setModal("reset-employee-password");
  };
  const submitEmployeePasswordReset = async (event) => {
    event.preventDefault();
    setDataError("");
    try {
      await requestApi("/api/employees", "PATCH", passwordResetForm);
      setModal(null);
      setPasswordResetForm({ uid: "", password: "" });
      setDataError("Temporary password updated. Share it with the employee securely.");
    } catch (error) {
      setDataError(`Could not reset employee password: ${error.message}`);
    }
  };
  const submitEmployeeEdit = async (event) => {
    event.preventDefault();
    setDataError("");
    try {
      const { uid, ...updates } = employeeEditForm;
      await requestApi("/api/employees", "PATCH", { uid, ...updates });
      await refreshRecords(firebaseUser, "Employees");
      setModal(null);
    } catch (error) {
      setDataError(`Could not update employee: ${error.message}`);
    }
  };
  const updateEmployeeStatus = async (employee, status) => {
    setDataError("");
    try {
      await requestApi("/api/employees", "PATCH", { uid: employee.uid, status });
      await refreshRecords(firebaseUser, "Employees");
    } catch (error) {
      setDataError(`Could not update employee status: ${error.message}`);
    }
  };
  const updateEmployeePermissions = async (uid, permissions) => {
    setDataError("");
    try {
      await requestApi("/api/employees", "PATCH", { uid, permissions });
      await refreshRecords(firebaseUser, "Employees");
    } catch (error) {
      setDataError(`Could not update employee permissions: ${error.message}`);
    }
  };
  const updateClientStatus = async (client, status) => {
    setDataError("");
    try {
      await requestApi("/api/clients", "PATCH", { clientId: client.id, status });
      await refreshRecords(firebaseUser, "Clients");
    } catch (error) {
      setDataError(`Could not update work status: ${error.message}`);
    }
  };
  const transferClient = async (clientId, assignedTo) => {
    setDataError("");
    try {
      await requestApi("/api/clients", "PATCH", { clientId, assignedTo });
      await refreshRecords(firebaseUser, "Clients");
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
      await requestApi("/api/payments", "POST", paymentForm);
      setPaymentForm({ clientId: "", amount: "", date: new Date().toISOString().slice(0, 10) });
      setModal(null);
      setActiveNav("Payments");
      if (activeNav === "Payments") {
        refreshRecords(firebaseUser, "Payments").catch((error) => setDataError(`Payment saved, but records could not refresh: ${error.message}`));
      }
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
      await requestApi("/api/services", "POST", serviceForm);
      setServiceForm({ name: "", category: "" });
      setModal(null);
      setActiveNav("Services");
      if (activeNav === "Services") {
        refreshRecords(firebaseUser, "Services").catch((error) => setDataError(`Service saved, but records could not refresh: ${error.message}`));
      }
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
        <div className="sidebar-bottom"><button className="nav-item"><Icon name="shield" /><span>Security center</span></button><button className="nav-item"><Icon name="grid" /><span>Settings</span></button><div className="support-card"><div className="support-icon"><Icon name="bell" size={16} /></div><strong>Need a hand?</strong><p>Visit the help center or contact support.</p><button>Open help center <Icon name="arrow" size={14} /></button></div><div className="user-mini"><div className="avatar avatar-teal">{session.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div><div><strong>{session.name}</strong><span>{session.roleLabel}</span></div><button className="logout-button" onClick={async () => { await fetch("/api/auth/session", { method: "DELETE" }); await signOut(auth); setSession(null); }}>Log out</button></div></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="arrow" size={14} /><strong>{activeNav}</strong></div><div className="top-actions"><div className="secure-tag"><span className="secure-dot" /> Data access: scoped</div><button className="icon-button"><Icon name="bell" /><i /></button><div className="top-avatar">AK</div></div></header>
        <div className="content-wrap">
          {dataError && <div className="empty-state" role="alert">{dataError}</div>}
          <div className="welcome-row">
            <div><p className="eyebrow">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p><h1>Good morning, {session.name.split(" ")[0]}</h1><p className="subheading">Here&apos;s what&apos;s happening across your practice today.</p></div>
            <div className="header-actions">
              {role === "Admin" && <label className="role-select"><span>Admin team view</span><select value={teamView} onChange={(event) => { setTeamView(event.target.value); setModal(null); }}><option value="All teams">All teams</option>{employeeRecords.map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
              <div className="role-select role-static"><span>Signed in as</span><strong>{session.roleLabel}</strong></div>
              {canAddClient && !isAdminPreview && <button className="primary-button" onClick={() => openModal("client")}><Icon name="plus" size={17} /> Add client</button>}
            </div>
          </div>
          <LiveOverview clients={scope.clients} isLoading={isLoading} />

          {activeNav === "Overview" ? <>
          <section className="panel clients-panel"><div className="panel-heading clients-heading"><div><h2>Recent clients</h2><p>Stay on top of your latest client activity</p></div><button className="text-button" onClick={() => setActiveNav("Clients")}>View all clients <Icon name="arrow" size={15} /></button></div><div className="table-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients..." /></div><div className="filter-tabs">{["All clients", "In Progress", "Pending", "Completed"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="filter-button">Filter <span>⌄</span></button></div><div className="table-scroll"><table><thead><tr><th>Client</th><th>Service</th><th>Assigned to</th><th>Work status</th><th>Payment</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>{visibleClients.map((client) => <tr key={client.id}><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td><div className="owner-cell"><div className="owner-avatar">{client.owner.split(" ").map((word) => word[0]).join("")}</div>{client.owner}</div></td><td><span className={`status-badge ${client.status.toLowerCase().replace(" ", "-")}`}><i />{client.status}</span></td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span><small className="payment-amount">{formatMoney(client.received)} / {formatMoney(client.amount)}</small></td><td className="date-cell">{client.date}</td><td><ClientRowActions client={client} canManage={!isAdminPreview && (session.role === "admin" || (client.assignedBy || client.createdBy) === session.uid)} onEditClient={openClientEdit} onDeleteClient={openClientDelete} /></td></tr>)}</tbody></table>{visibleClients.length === 0 && <div className="empty-state">No authorized clients match this search.</div>}</div><div className="table-footer"><span>Showing <strong>{visibleClients.length}</strong> of <strong>{scope.clients.length}</strong> authorized clients</span><div className="pagination"><button disabled>‹</button><button className="current">1</button><button>2</button><button>3</button><button>›</button></div></div></section>
          </> : <WorkspaceView section={activeNav} role={isAdminPreview ? `Preview: ${employeeRecords.find((employee) => employee.uid === teamView)?.name || "Employee"}` : role} clients={scope.clients} employeeRecords={scopedEmployees} serviceRecords={scopedServices} paymentRecords={scopedPayments} query={query} setQuery={setQuery} onAction={openModal} onClientStatusChange={updateClientStatus} onClientTransfer={transferClient} onEditClient={openClientEdit} onDeleteClient={openClientDelete} onEmployeeStatusChange={updateEmployeeStatus} onEditEmployee={openEmployeeEdit} onResetEmployeePassword={openEmployeePasswordReset} onEmployeePermissionsChange={updateEmployeePermissions} currentUid={session.uid} isAdmin={session.role === "admin"} canManageEmployees={canManageEmployees && !isAdminPreview} canManagePermissions={session.permissions.includes("manage_permissions") && !isAdminPreview} canManageServices={canManageServices && !isAdminPreview} canAddClient={canAddClient && !isAdminPreview} employeeRoleOptions={employeeRoleOptions} readOnlyPreview={isAdminPreview} />}
        </div>
      </section>
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setClientToDelete(null); } }}>
        <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby={modal === "delete-client" ? "delete-client-description" : undefined}>
          <div className="modal-header"><div><p className="eyebrow">{modal === "client" ? "Client assignment" : modal === "delete-client" || modal === "edit-client" ? "Client record" : modal === "payment" ? "Payment entry" : modal === "service" ? "Service management" : "Team access"}</p><h2 id="modal-title">{modal === "client" ? "Add new client" : modal === "delete-client" ? "Delete client permanently?" : modal === "employee" ? "Add new employee" : modal === "edit-client" ? "Edit client" : modal === "edit-employee" ? "Edit employee" : modal === "reset-employee-password" ? "Reset employee password" : modal === "service" ? "Add service" : "Record payment"}</h2></div><button className="modal-close" onClick={() => { setModal(null); setClientToDelete(null); }} aria-label="Close dialog">&times;</button></div>
          {modal === "client" ? <form onSubmit={submitClient}>
            <div className="form-grid client-form-grid">
              <label>Date<input required type="date" value={clientForm.date} onChange={(event) => setClientForm({ ...clientForm, date: event.target.value })} /></label>
              <label>Client name<input required value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} placeholder="e.g. Falcon Traders" /></label>
              <label>Client provider<input required value={clientForm.provider} onChange={(event) => setClientForm({ ...clientForm, provider: event.target.value })} placeholder="e.g. XYZ Provider" /></label>
              <label>Cell<input required value={clientForm.cell} onChange={(event) => setClientForm({ ...clientForm, cell: event.target.value })} placeholder="03XX-XXXXXXX" /></label>
              <label>CNIC<input required value={clientForm.cnic} onChange={(event) => setClientForm({ ...clientForm, cnic: event.target.value })} placeholder="XXXXX-XXXXXXX-X" /></label>
              <label>PIN<input required value={clientForm.pin} onChange={(event) => setClientForm({ ...clientForm, pin: event.target.value })} placeholder="Client PIN" /></label>
              <PasswordField label="Password" name="password" value={clientForm.password} onChange={(event) => setClientForm({ ...clientForm, password: event.target.value })} placeholder="Client password" minLength={6} autoComplete="new-password" />
              <label>Email<input required type="email" value={clientForm.email} onChange={(event) => setClientForm({ ...clientForm, email: event.target.value })} placeholder="client@email.com" /></label>
              <label>Work<input required value={clientForm.work} onChange={(event) => setClientForm({ ...clientForm, work: event.target.value })} placeholder="e.g. NTN Registration" /></label>
              <label className="description-field">Description (optional)<textarea value={clientForm.description} onChange={(event) => setClientForm({ ...clientForm, description: event.target.value })} placeholder="Client requirements or notes" rows={3} /></label>
              <label>Assigned employee<select required value={clientForm.assignedTo} onChange={(event) => setClientForm({ ...clientForm, assignedTo: event.target.value })}><option value="">Select employee</option>{employeeRecords.filter((employee) => employee.status === "Active" && employeeRoleOptions.some((allowedRole) => ({ sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" })[allowedRole] === employee.role)).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>
              <label>Total amount<input required type="number" min="0" value={clientForm.amount} onChange={(event) => setClientForm({ ...clientForm, amount: event.target.value })} placeholder="100000" /></label>
              <label>Received amount<input type="number" min="0" value={clientForm.received} onChange={(event) => setClientForm({ ...clientForm, received: event.target.value })} placeholder="0" /></label>
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> Remaining amount is calculated automatically. Client access will be scoped to the assigned employee.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "client" ? "Saving..." : "Create client"}</button></div>
          </form> : modal === "edit-client" ? <form onSubmit={submitClientEdit}>
            <div className="form-grid client-form-grid">
              <label>Date<input required type="date" value={clientEditForm.date} onChange={(event) => setClientEditForm({ ...clientEditForm, date: event.target.value })} /></label>
              <label>Client name<input required value={clientEditForm.name} onChange={(event) => setClientEditForm({ ...clientEditForm, name: event.target.value })} /></label>
              <label>Client provider<input required value={clientEditForm.provider} onChange={(event) => setClientEditForm({ ...clientEditForm, provider: event.target.value })} /></label>
              <label>Cell<input value={clientEditForm.cell} onChange={(event) => setClientEditForm({ ...clientEditForm, cell: event.target.value })} /></label>
              <label>CNIC<input value={clientEditForm.cnic} onChange={(event) => setClientEditForm({ ...clientEditForm, cnic: event.target.value })} /></label>
              <label>PIN<input value={clientEditForm.pin} onChange={(event) => setClientEditForm({ ...clientEditForm, pin: event.target.value })} /></label>
              <PasswordField label="Client password" name="client-password" value={clientEditForm.password} onChange={(event) => setClientEditForm({ ...clientEditForm, password: event.target.value })} minLength={0} required={false} />
              <label>Email<input type="email" value={clientEditForm.email} onChange={(event) => setClientEditForm({ ...clientEditForm, email: event.target.value })} /></label>
              <label>Work<input value={clientEditForm.work} onChange={(event) => setClientEditForm({ ...clientEditForm, work: event.target.value })} /></label>
              <label>Total amount<input required type="number" min="0" value={clientEditForm.totalAmount} onChange={(event) => setClientEditForm({ ...clientEditForm, totalAmount: event.target.value })} /></label>
              <label>Received amount<input required type="number" min="0" value={clientEditForm.totalReceived} onChange={(event) => setClientEditForm({ ...clientEditForm, totalReceived: event.target.value })} /></label>
              <label className="description-field">Description (optional)<textarea value={clientEditForm.description} onChange={(event) => setClientEditForm({ ...clientEditForm, description: event.target.value })} rows={3} /></label>
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "edit-client" ? "Saving..." : "Save changes"}</button></div>
          </form> : modal === "delete-client" ? <div>
            <p id="delete-client-description" className="form-note delete-warning">This will permanently delete <strong>{clientToDelete?.name}</strong>, all its payment records, and linked services. This action cannot be undone.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" disabled={savingAction !== null} onClick={() => { setModal(null); setClientToDelete(null); }}>Cancel</button><button type="button" className="danger-button" disabled={savingAction !== null} onClick={deleteClient}>{savingAction === "delete-client" ? "Deleting..." : "Delete permanently"}</button></div>
          </div> : modal === "employee" ? <form onSubmit={submitEmployee}>
            <div className="form-grid">
              <label>Full name<input name="name" required placeholder="e.g. Hira Malik" /></label>
              <label>Email<input name="email" required type="email" placeholder="name@ptpconsultant.pk" /></label>
              <label>Phone<input name="phone" required type="tel" placeholder="03XX-XXXXXXX" /></label>
              <label>Role<select name="role" required value={newEmployeeRole} onChange={(event) => setNewEmployeeRole(event.target.value)}> <option value="" disabled>Select role</option>{employeeRoleOptions.map((employeeRole) => <option key={employeeRole} value={employeeRole}>{({ sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" })[employeeRole]}</option>)}</select></label>
              {session.role === "admin" && <label>Reports to<select name="managerUid" required defaultValue=""><option value="" disabled>Select manager</option><option value={session.uid}>Admin · {session.name}</option>{employeeRecords.filter((employee) => ({ admin: 0, sub_admin: 1, senior_technical: 2, jn_technical: 3 })[employee.roleCode] < ({ admin: 0, sub_admin: 1, senior_technical: 2, jn_technical: 3 })[newEmployeeRole]).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
              <PasswordField label="Temporary password" name="password" minLength={8} autoComplete="new-password" required />
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> The employee can sign in through the common login page.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button" disabled={savingAction !== null}>{savingAction === "employee" ? "Saving..." : "Create employee"}</button></div>
          </form> : modal === "reset-employee-password" ? <form onSubmit={submitEmployeePasswordReset}>
            <div className="form-grid">
              <PasswordField label="New temporary password" name="password" value={passwordResetForm.password} onChange={(event) => setPasswordResetForm({ ...passwordResetForm, password: event.target.value })} minLength={8} autoComplete="new-password" />
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> The existing password cannot be viewed. This sets a new Firebase Auth password and is not saved in Firestore.</p>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button">Set new password</button></div>
          </form> : modal === "edit-employee" ? <form onSubmit={submitEmployeeEdit}>
            <div className="form-grid">
              <label>Full name<input required value={employeeEditForm.name} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, name: event.target.value })} /></label>
              <label>Email<input required type="email" value={employeeEditForm.email} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, email: event.target.value })} /></label>
              <label>Phone<input required type="tel" value={employeeEditForm.phone} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, phone: event.target.value })} /></label>
              <label>Role<select required value={employeeEditForm.role} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, role: event.target.value })}>{employeeRoleOptions.map((employeeRole) => <option key={employeeRole} value={employeeRole}>{({ sub_admin: "Sub Admin", senior_technical: "Senior Technical", jn_technical: "JN Technical" })[employeeRole]}</option>)}</select></label>
              {session.role === "admin" && <label>Reports to<select required value={employeeEditForm.managerUid} onChange={(event) => setEmployeeEditForm({ ...employeeEditForm, managerUid: event.target.value })}><option value={session.uid}>Admin · {session.name}</option>{employeeRecords.filter((employee) => employee.uid !== employeeEditForm.uid && ({ admin: 0, sub_admin: 1, senior_technical: 2, jn_technical: 3 })[employee.roleCode] < ({ admin: 0, sub_admin: 1, senior_technical: 2, jn_technical: 3 })[employeeEditForm.role]).map((employee) => <option key={employee.uid} value={employee.uid}>{employee.name} · {employee.role}</option>)}</select></label>}
            </div>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button">Save employee</button></div>
          </form> : modal === "service" ? <form onSubmit={submitService}>
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
            </div>
            <p className="form-note"><Icon name="shield" size={14} /> Partial and multiple payments update the remaining balance automatically.</p>
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
