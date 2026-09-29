"use client";

import { useMemo, useState } from "react";

const clients = [
  { id: "PTP-1048", name: "Nexa Foods (Pvt.) Ltd.", provider: "Corporate Tax", owner: "M. Saad", initials: "NF", status: "In Progress", payment: "Pending", amount: 185000, received: 120000, date: "28 Sep 2026", color: "mint" },
  { id: "PTP-1047", name: "Horizon Builders", provider: "NTN Registration", owner: "A. Khan", initials: "HB", status: "Pending", payment: "Pending", amount: 85000, received: 0, date: "27 Sep 2026", color: "lavender" },
  { id: "PTP-1046", name: "Apex Digital Studio", provider: "Sales Tax Return", owner: "S. Ahmed", initials: "AD", status: "Completed", payment: "Received", amount: 120000, received: 120000, date: "26 Sep 2026", color: "yellow" },
  { id: "PTP-1045", name: "Greenline Traders", provider: "Income Tax Return", owner: "M. Saad", initials: "GT", status: "In Progress", payment: "Pending", amount: 65000, received: 25000, date: "25 Sep 2026", color: "peach" },
  { id: "PTP-1044", name: "Sapphire Textiles", provider: "Withholding Tax", owner: "R. Tariq", initials: "ST", status: "Completed", payment: "Received", amount: 210000, received: 210000, date: "24 Sep 2026", color: "blue" },
];

const navItems = [
  ["Overview", "grid"], ["Clients", "users"], ["Employees", "briefcase"], ["Services", "layers"], ["Payments", "wallet"], ["Reports", "chart"], ["Excel records", "file"],
];

const roleScopes = {
  Admin: { label: "Administrator", clients: clients },
  "Sub Admin": { label: "Operations lead", clients: clients.slice(0, 4) },
  "Senior Technical": { label: "Senior technical", clients: clients.filter((client) => ["M. Saad", "S. Ahmed"].includes(client.owner)) },
  "JN Technical": { label: "Junior technical", clients: clients.slice(0, 2) },
};

const employees = [
  { name: "Adnan Khan", role: "Admin", clients: 39, status: "Active", initials: "AK" },
  { name: "M. Saad", role: "Senior Technical", clients: 14, status: "Active", initials: "MS" },
  { name: "S. Ahmed", role: "Senior Technical", clients: 11, status: "Active", initials: "SA" },
  { name: "A. Khan", role: "JN Technical", clients: 8, status: "Active", initials: "AK" },
  { name: "R. Tariq", role: "JN Technical", clients: 6, status: "Inactive", initials: "RT" },
];

const services = [
  { name: "Corporate Tax Return", category: "Tax filing", clients: 18, amount: "Rs. 425k", status: "Active" },
  { name: "Sales Tax Return", category: "Tax filing", clients: 14, amount: "Rs. 286k", status: "Active" },
  { name: "NTN Registration", category: "Registration", clients: 9, amount: "Rs. 153k", status: "Active" },
  { name: "Income Tax Return", category: "Tax filing", clients: 12, amount: "Rs. 312k", status: "Active" },
  { name: "Withholding Tax", category: "Compliance", clients: 7, amount: "Rs. 98k", status: "Active" },
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
  return `Rs. ${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`;
}

function downloadExcelRecords(records) {
  const headers = ["S.NO", "Date", "Client Name", "Client Provider", "Cell", "CNIC", "PIN", "Password", "Email", "Work", "Total Amount", "Received Amount", "Remaining Amount", "Payment Status"];
  const rows = records.map((client, index) => [index + 1, client.date || "29 Sep 2026", client.name, client.provider, client.cell || "", client.cnic || "", client.pin || "", client.password || "", client.email || "", client.work || client.provider, client.amount || 0, client.received || 0, Math.max((client.amount || 0) - (client.received || 0), 0), client.payment || "Pending"]);
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `PTP-completed-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

  return <main className="auth-shell"><section className="auth-visual"><div className="auth-brand"><div className="brand-mark">PTP</div><span>Professional Tax Partner</span></div><div className="auth-visual-content"><p className="eyebrow">Private operations workspace</p><h1>Clarity for every<br /><em>client decision.</em></h1><p>One secure place to manage tax work, assignments, payments, and your team.</p><div className="auth-proof"><div className="proof-avatars"><span>AK</span><span>MS</span><span>SA</span><b>+12</b></div><div><strong>Trusted by your team</strong><small>Secure role-based access</small></div></div></div><div className="auth-visual-footer"><span>© 2026 Professional Tax Partner</span><span><i /> Systems operational</span></div></section><section className="auth-panel"><div className="auth-card"><div className="mobile-auth-brand"><div className="brand-mark">PTP</div><strong>Professional Tax Partner</strong></div><div className="auth-heading"><span className="auth-kicker">ADMIN ACCESS ONLY</span><h2>{mode === "login" ? "Welcome back" : "Create admin account"}</h2><p>{mode === "login" ? "Sign in to manage your consultancy workspace." : "Set up the administrator account for your workspace."}</p></div><div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button></div><form className="auth-form" onSubmit={submitAuth}>{mode === "signup" && <label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Adnan Khan" /></label>}<label>Admin email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="admin@ptpconsultant.pk" /></label><label>Password<input required type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Enter your password" /></label>{mode === "signup" && <label>Confirm password<input required type="password" minLength={6} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} placeholder="Repeat your password" /></label>}{error && <div className="auth-error">{error}</div>}<button type="submit" className="auth-submit">{mode === "login" ? "Sign in to workspace" : "Create admin account"}<Icon name="arrow" size={16} /></button></form><div className="auth-security"><Icon name="shield" size={16} /><span><strong>Admin-only workspace</strong><small>Employee accounts are created from inside the Admin portal.</small></span></div>{mode === "login" && <p className="demo-login">Demo: <strong>admin@ptpconsultant.pk</strong> / <strong>Admin@123</strong></p>}</div></section></main>;
}

function WorkspaceView({ section, role, clients, employeeRecords, query, setQuery, onAction }) {
  const sectionMeta = {
    Clients: { title: "Clients", subtitle: "Only clients available to your current role are shown.", action: "Add client" },
    Employees: { title: "Employees", subtitle: "Manage team access and assigned workload.", action: "Add employee" },
    Services: { title: "Services", subtitle: "Your practice services and their active client assignments.", action: "Add service" },
    Payments: { title: "Payments", subtitle: "Track received installments and outstanding balances.", action: "Record payment" },
    Reports: { title: "Reports", subtitle: "Operational reports generated from authorized records.", action: "Export report" },
    "Excel records": { title: "Excel records", subtitle: "Completed records available within your permission scope.", action: "Download Excel" },
  };
  const meta = sectionMeta[section] || sectionMeta.Clients;
  const normalizedQuery = query.toLowerCase();
  const scopedEmployees = employeeRecords.filter((employee) => role === "Admin" || employee.name === "Adnan Khan" || clients.some((client) => client.owner === employee.name));
  const filteredClients = clients.filter((client) => `${client.name} ${client.provider} ${client.owner}`.toLowerCase().includes(normalizedQuery));
  const filteredEmployees = scopedEmployees.filter((employee) => `${employee.name} ${employee.role}`.toLowerCase().includes(normalizedQuery));
  const filteredServices = services.filter((service) => `${service.name} ${service.category}`.toLowerCase().includes(normalizedQuery));

  return <section className="workspace-view">
    <div className="workspace-header"><div><p className="eyebrow">{role} workspace</p><h2>{meta.title}</h2><p>{meta.subtitle}</p></div>{section === "Excel records" ? <button className="primary-button" onClick={() => downloadExcelRecords(filteredClients)}><Icon name="file" size={16} /> {meta.action}</button> : <button className="primary-button" onClick={() => onAction(section === "Employees" ? "employee" : section === "Clients" ? "client" : "service")}><Icon name="plus" size={17} /> {meta.action}</button>}</div>
    <div className="workspace-summary"><div className="summary-tile"><span>Visible records</span><strong>{section === "Employees" ? filteredEmployees.length : section === "Services" ? filteredServices.length : filteredClients.length}</strong><small>Scoped to your access</small></div><div className="summary-tile"><span>Active {section.toLowerCase()}</span><strong>{section === "Employees" ? filteredEmployees.filter((item) => item.status === "Active").length : section === "Services" ? filteredServices.filter((item) => item.status === "Active").length : filteredClients.filter((item) => item.status !== "Completed").length}</strong><small>Currently in progress</small></div><div className="summary-tile"><span>Role scope</span><strong className="scope-value">{role}</strong><small><span className="secure-dot" /> Protected view</small></div></div>
    <div className="panel workspace-panel"><div className="workspace-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${section.toLowerCase()}...`} /></div><button className="filter-button">Filter <span>⌄</span></button></div>
      {section === "Employees" && <div className="table-scroll"><table><thead><tr><th>Employee</th><th>Role</th><th>Assigned clients</th><th>Account status</th><th>Access</th><th /></tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.name}><td><div className="client-cell"><div className="client-avatar mint">{employee.initials}</div><div><strong>{employee.name}</strong><span>{employee.name.toLowerCase().replace(" ", ".")}@ptpconsultant.pk</span></div></div></td><td>{employee.role}</td><td>{employee.clients} clients</td><td><span className={`status-badge ${employee.status === "Active" ? "completed" : "pending"}`}><i />{employee.status}</span></td><td><span className="payment-badge received">Scoped access</span></td><td><button className="row-more">•••</button></td></tr>)}</tbody></table></div>}
      {section === "Clients" && <div className="table-scroll"><table className="client-record-table"><thead><tr><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Pending</th><th>Received</th><th /></tr></thead><tbody>{filteredClients.map((client) => <tr key={client.id}><td className="date-cell">{client.date || "29 Sep 2026"}</td><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password ? "••••••" : "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td className="money-cell">{formatMoney(Math.max(client.amount - client.received, 0))}</td><td className="money-cell">{formatMoney(client.received)}</td><td><button className="row-more">•••</button></td></tr>)}</tbody></table></div>}
      {section === "Services" && <div className="table-scroll"><table><thead><tr><th>Service</th><th>Category</th><th>Active clients</th><th>Collected</th><th>Status</th><th /></tr></thead><tbody>{filteredServices.map((service) => <tr key={service.name}><td><div className="service-cell"><div className="service-icon"><Icon name="layers" size={15} /></div><strong>{service.name}</strong></div></td><td>{service.category}</td><td>{service.clients}</td><td className="money-cell">{service.amount}</td><td><span className="status-badge completed"><i />{service.status}</span></td><td><button className="row-more">•••</button></td></tr>)}</tbody></table></div>}
      {section === "Excel records" && <div className="table-scroll"><table className="excel-record-table"><thead><tr><th>S.NO</th><th>Date</th><th>Client Name</th><th>Client Provider</th><th>Cell</th><th>CNIC</th><th>PIN</th><th>Password</th><th>Email</th><th>Work</th><th>Total Amount</th><th>Received Amount</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{filteredClients.map((client, index) => <tr key={client.id}><td>{index + 1}</td><td>{client.date || "29 Sep 2026"}</td><td><strong>{client.name}</strong><span className="record-id">{client.id}</span></td><td>{client.provider}</td><td>{client.cell || "-"}</td><td>{client.cnic || "-"}</td><td>{client.pin || "-"}</td><td>{client.password ? "••••••" : "-"}</td><td>{client.email || "-"}</td><td>{client.work || client.provider}</td><td>{formatMoney(client.amount)}</td><td className="money-cell">{formatMoney(client.received)}</td><td className="money-cell">{formatMoney(Math.max(client.amount - client.received, 0))}</td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span></td></tr>)}</tbody></table></div>}
      {(section === "Payments" || section === "Reports") && <div className="empty-workspace"><div className="workspace-icon"><Icon name={section === "Payments" ? "wallet" : "chart"} size={24} /></div><h3>{meta.title} are ready</h3><p>This view is scoped to <strong>{role}</strong>. Connect the Firebase collection to load live {section.toLowerCase()} without exposing unauthorized records.</p><button className="text-button">Open {section.toLowerCase()} <Icon name="arrow" size={15} /></button></div>}
      {((section === "Employees" && filteredEmployees.length === 0) || (section === "Clients" && filteredClients.length === 0) || (section === "Services" && filteredServices.length === 0)) && <div className="empty-state">No authorized {section.toLowerCase()} match this search.</div>}
    </div>
  </section>;
}

export default function Home() {
  const [session, setSession] = useState(() => {
    if (typeof window === "undefined") return null;
    const storedSession = window.localStorage.getItem("ptp-session");
    return storedSession ? JSON.parse(storedSession) : null;
  });
  const [role, setRole] = useState("Admin");
  const [teamView, setTeamView] = useState("All teams");
  const [activeNav, setActiveNav] = useState("Overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All clients");
  const [clientRecords, setClientRecords] = useState(clients);
  const [employeeRecords, setEmployeeRecords] = useState(employees);
  const [modal, setModal] = useState(null);
  const [clientForm, setClientForm] = useState({ date: "2026-09-29", name: "", provider: "Corporate Tax", cell: "", cnic: "", pin: "", password: "", email: "", work: "", owner: "M. Saad", amount: "", received: "" });
  const scopedClients = teamView === "All teams" ? clientRecords : teamView === "Sub Admin" ? clientRecords.slice(0, 4) : teamView === "Senior Technical" ? clientRecords.filter((client) => ["M. Saad", "S. Ahmed"].includes(client.owner)) : clientRecords.slice(0, 2);
  const scope = { ...roleScopes.Admin, clients: scopedClients };
  const visibleClients = useMemo(() => scope.clients.filter((client) => {
    const matchesQuery = `${client.name} ${client.provider} ${client.owner}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All clients" || client.status === filter;
    return matchesQuery && matchesFilter;
  }), [scope.clients, query, filter]);

  const totalAmount = scope.clients.reduce((sum, client) => sum + client.amount, 0);
  const totalReceived = scope.clients.reduce((sum, client) => sum + client.received, 0);
  const openModal = (type) => setModal(type);
  const submitClient = (event) => {
    event.preventDefault();
    const total = Number(clientForm.amount) || 0;
    const received = Number(clientForm.received) || 0;
    setClientRecords((current) => [{ id: `PTP-${1049 + current.length}`, date: clientForm.date, name: clientForm.name, provider: clientForm.provider, cell: clientForm.cell, cnic: clientForm.cnic, pin: clientForm.pin, password: clientForm.password, email: clientForm.email, work: clientForm.work, owner: clientForm.owner, initials: clientForm.name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(), status: "Pending", payment: received >= total && total > 0 ? "Received" : "Pending", amount: total, received, color: "mint" }, ...current]);
    setClientForm({ date: "2026-09-29", name: "", provider: "Corporate Tax", cell: "", cnic: "", pin: "", password: "", email: "", work: "", owner: "M. Saad", amount: "", received: "" });
    setModal(null);
    setActiveNav("Clients");
  };
  const submitEmployee = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name").trim();
    const roleName = formData.get("role");
    const initials = name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
    setEmployeeRecords((current) => [...current, { name, role: roleName, clients: 0, status: "Active", initials }]);
    setModal(null);
    setActiveNav("Employees");
  };

  if (!session) return <AuthScreen onAuthenticated={setSession} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">PTP</div><div><strong>Professional<br />Tax Partner</strong><span>Consultant CRM</span></div></div>
        <div className="workspace-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map(([label, icon]) => <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => setActiveNav(label)}><Icon name={icon} /><span>{label}</span>{label === "Clients" && <b className="nav-count">{scope.clients.length}</b>}</button>)}
        </nav>
        <div className="sidebar-bottom"><button className="nav-item"><Icon name="shield" /><span>Security center</span></button><button className="nav-item"><Icon name="grid" /><span>Settings</span></button><div className="support-card"><div className="support-icon"><Icon name="bell" size={16} /></div><strong>Need a hand?</strong><p>Visit the help center or contact support.</p><button>Open help center <Icon name="arrow" size={14} /></button></div><div className="user-mini"><div className="avatar avatar-teal">AK</div><div><strong>{session.name}</strong><span>Administrator</span></div><button className="logout-button" onClick={() => { window.localStorage.removeItem("ptp-session"); setSession(null); }}>Log out</button></div></div>
      </aside>

      <section className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><Icon name="arrow" size={14} /><strong>{activeNav}</strong></div><div className="top-actions"><div className="secure-tag"><span className="secure-dot" /> Data access: scoped</div><button className="icon-button"><Icon name="bell" /><i /></button><div className="top-avatar">AK</div></div></header>
        <div className="content-wrap">
          <div className="welcome-row"><div><p className="eyebrow">Monday, 29 September 2026</p><h1>Good morning, {session.name.split(" ")[0]} <span>✦</span></h1><p className="subheading">Here&apos;s what&apos;s happening across your practice today.</p></div><div className="header-actions"><label className="role-select"><span>Admin team view</span><select value={teamView} onChange={(event) => setTeamView(event.target.value)}><option>All teams</option><option>Sub Admin</option><option>Senior Technical</option><option>JN Technical</option></select></label><div className="role-select role-static"><span>Signed in as</span><strong>Administrator</strong></div><button className="primary-button" onClick={() => openModal("client")}><Icon name="plus" size={17} /> Add client</button></div></div>

          {activeNav === "Overview" ? <>
          <div className="stats-grid"><div className="stat-card stat-teal"><div className="stat-top"><span>Total clients</span><span className="stat-icon"><Icon name="users" size={16} /></span></div><strong>{scope.clients.length + 34}</strong><div className="stat-foot"><span className="trend-up">↗ 12.5%</span><span>vs last month</span></div></div><div className="stat-card"><div className="stat-top"><span>Active work</span><span className="stat-icon gray"><Icon name="briefcase" size={16} /></span></div><strong>{scope.clients.filter((client) => client.status === "In Progress" || client.status === "Pending").length + 16}</strong><div className="stat-foot"><span className="trend-up">↗ 8.2%</span><span>vs last month</span></div></div><div className="stat-card"><div className="stat-top"><span>Total received</span><span className="stat-icon yellow"><Icon name="wallet" size={16} /></span></div><strong>{formatMoney(totalReceived + 1245000)}</strong><div className="stat-foot"><span className="trend-up">↗ 18.7%</span><span>vs last month</span></div></div><div className="stat-card"><div className="stat-top"><span>Outstanding</span><span className="stat-icon coral"><Icon name="chart" size={16} /></span></div><strong>{formatMoney(totalAmount - totalReceived + 780000)}</strong><div className="stat-foot"><span className="trend-down">↘ 4.1%</span><span>vs last month</span></div></div></div>

          <div className="dashboard-grid"><section className="panel revenue-panel"><div className="panel-heading"><div><h2>Revenue overview</h2><p>Collected vs outstanding payments</p></div><button className="select-button">Last 6 months <span>⌄</span></button></div><div className="chart-legend"><span><i className="legend-dot collected" /> Collected</span><span><i className="legend-dot outstanding" /> Outstanding</span></div><div className="chart"><div className="y-labels"><span>Rs. 1.2m</span><span>Rs. 900k</span><span>Rs. 600k</span><span>Rs. 300k</span><span>Rs. 0</span></div><div className="chart-area"><div className="grid-lines"><i /><i /><i /><i /><i /></div><svg viewBox="0 0 620 190" preserveAspectRatio="none" className="chart-line"><path className="fill-collected" d="M0 145 C45 130 72 140 110 110 S165 126 205 92 S260 112 295 75 S350 95 390 62 S455 80 495 43 S560 53 620 22 V190 H0 Z" /><path className="fill-outstanding" d="M0 166 C45 160 72 165 110 148 S165 160 205 137 S260 145 295 124 S350 140 390 113 S455 126 495 103 S560 110 620 85 V190 H0 Z" /><path className="stroke-collected" d="M0 145 C45 130 72 140 110 110 S165 126 205 92 S260 112 295 75 S350 95 390 62 S455 80 495 43 S560 53 620 22" /><path className="stroke-outstanding" d="M0 166 C45 160 72 165 110 148 S165 160 205 137 S260 145 295 124 S350 140 390 113 S455 126 495 103 S560 110 620 85" /></svg><div className="x-labels"><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div></div></div></section><section className="panel work-panel"><div className="panel-heading"><div><h2>Work status</h2><p>Current client workload</p></div><button className="more-button">•••</button></div><div className="donut-wrap"><div className="donut"><div><strong>{scope.clients.length + 34}</strong><span>total clients</span></div></div><div className="status-list"><div><i className="status-dot teal" /><span>Completed</span><strong>52%</strong></div><div><i className="status-dot yellow" /><span>In progress</span><strong>28%</strong></div><div><i className="status-dot gray" /><span>Pending</span><strong>15%</strong></div><div><i className="status-dot coral" /><span>Cancelled</span><strong>5%</strong></div></div></div><div className="work-foot"><span>Completion rate</span><strong>+6.4% <small>this month</small></strong></div></section></div>

          <section className="panel clients-panel"><div className="panel-heading clients-heading"><div><h2>Recent clients</h2><p>Stay on top of your latest client activity</p></div><button className="text-button" onClick={() => setActiveNav("Clients")}>View all clients <Icon name="arrow" size={15} /></button></div><div className="table-toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients..." /></div><div className="filter-tabs">{["All clients", "In Progress", "Pending", "Completed"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="filter-button">Filter <span>⌄</span></button></div><div className="table-scroll"><table><thead><tr><th>Client</th><th>Service</th><th>Assigned to</th><th>Work status</th><th>Payment</th><th>Last updated</th><th /></tr></thead><tbody>{visibleClients.map((client) => <tr key={client.id}><td><div className="client-cell"><div className={`client-avatar ${client.color}`}>{client.initials}</div><div><strong>{client.name}</strong><span>{client.id}</span></div></div></td><td>{client.provider}</td><td><div className="owner-cell"><div className="owner-avatar">{client.owner.split(" ").map((word) => word[0]).join("")}</div>{client.owner}</div></td><td><span className={`status-badge ${client.status.toLowerCase().replace(" ", "-")}`}><i />{client.status}</span></td><td><span className={`payment-badge ${client.payment.toLowerCase()}`}>{client.payment}</span><small className="payment-amount">{formatMoney(client.received)} / {formatMoney(client.amount)}</small></td><td className="date-cell">{client.date}</td><td><button className="row-more">•••</button></td></tr>)}</tbody></table>{visibleClients.length === 0 && <div className="empty-state">No authorized clients match this search.</div>}</div><div className="table-footer"><span>Showing <strong>{visibleClients.length}</strong> of <strong>{scope.clients.length}</strong> authorized clients</span><div className="pagination"><button disabled>‹</button><button className="current">1</button><button>2</button><button>3</button><button>›</button></div></div></section>
          <div className="bottom-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Updates from your team</p></div><button className="more-button">•••</button></div><div className="activity-list"><div className="activity-item"><div className="activity-icon purple"><Icon name="users" size={15} /></div><div><strong>Sarah Ahmed completed a task</strong><p>Sales Tax Return for Apex Digital Studio</p></div><time>12 min ago</time></div><div className="activity-item"><div className="activity-icon yellow"><Icon name="wallet" size={15} /></div><div><strong>Payment received from Nexa Foods</strong><p>Installment 2 of Rs. 65,000 recorded</p></div><time>48 min ago</time></div><div className="activity-item"><div className="activity-icon teal"><Icon name="briefcase" size={15} /></div><div><strong>New client assigned to you</strong><p>Horizon Builders · NTN Registration</p></div><time>2 hrs ago</time></div></div></section><section className="panel security-panel"><div className="security-heading"><div className="security-shield"><Icon name="shield" size={20} /></div><div><h2>Privacy & access</h2><p>Your workspace is protected</p></div></div><div className="security-row"><span>Role-based access</span><b>Active</b></div><div className="security-row"><span>Last security review</span><strong>Today, 09:42 AM</strong></div><button className="security-link">Review permissions <Icon name="arrow" size={14} /></button></section></div>
          </> : <WorkspaceView section={activeNav} role={role} clients={scope.clients} employeeRecords={employeeRecords} query={query} setQuery={setQuery} onAction={openModal} />}
        </div>
      </section>
      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><p className="eyebrow">{modal === "client" ? "Client assignment" : "Team access"}</p><h2 id="modal-title">{modal === "client" ? "Add new client" : "Add new employee"}</h2></div><button className="modal-close" onClick={() => setModal(null)} aria-label="Close dialog">×</button></div>{modal === "client" ? <form onSubmit={submitClient}><div className="form-grid client-form-grid"><label>Date<input required type="date" value={clientForm.date} onChange={(event) => setClientForm({ ...clientForm, date: event.target.value })} /></label><label>Client name<input required value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} placeholder="e.g. Falcon Traders" /></label><label>Client provider<input required value={clientForm.provider} onChange={(event) => setClientForm({ ...clientForm, provider: event.target.value })} placeholder="e.g. XYZ Provider" /></label><label>Cell<input required value={clientForm.cell} onChange={(event) => setClientForm({ ...clientForm, cell: event.target.value })} placeholder="03XX-XXXXXXX" /></label><label>CNIC<input required value={clientForm.cnic} onChange={(event) => setClientForm({ ...clientForm, cnic: event.target.value })} placeholder="XXXXX-XXXXXXX-X" /></label><label>PIN<input required value={clientForm.pin} onChange={(event) => setClientForm({ ...clientForm, pin: event.target.value })} placeholder="Client PIN" /></label><label>Password<input required type="password" value={clientForm.password} onChange={(event) => setClientForm({ ...clientForm, password: event.target.value })} placeholder="Client password" /></label><label>Email<input required type="email" value={clientForm.email} onChange={(event) => setClientForm({ ...clientForm, email: event.target.value })} placeholder="client@email.com" /></label><label>Work<input required value={clientForm.work} onChange={(event) => setClientForm({ ...clientForm, work: event.target.value })} placeholder="e.g. NTN Registration" /></label><label>Assigned employee<select value={clientForm.owner} onChange={(event) => setClientForm({ ...clientForm, owner: event.target.value })}><option>M. Saad</option><option>S. Ahmed</option><option>A. Khan</option><option>R. Tariq</option></select></label><label>Total amount<input required type="number" min="0" value={clientForm.amount} onChange={(event) => setClientForm({ ...clientForm, amount: event.target.value })} placeholder="100000" /></label><label>Received amount<input type="number" min="0" value={clientForm.received} onChange={(event) => setClientForm({ ...clientForm, received: event.target.value })} placeholder="0" /></label></div><p className="form-note"><Icon name="shield" size={14} /> Remaining amount is calculated automatically. Client access will be scoped to the assigned employee.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button">Create client</button></div></form> : <form onSubmit={submitEmployee}><div className="form-grid"><label>Full name<input name="name" required placeholder="e.g. Hira Malik" /></label><label>Email<input name="email" required type="email" placeholder="name@ptpconsultant.pk" /></label><label>Phone<input name="phone" required placeholder="03XX-XXXXXXX" /></label><label>Role<select name="role" defaultValue="Senior Technical"><option>Sub Admin</option><option>Senior Technical</option><option>JN Technical</option></select></label></div><p className="form-note"><Icon name="shield" size={14} /> A secure invitation will be sent after Firebase Authentication is connected.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="primary-button">Create employee</button></div></form>}</div></div>}
    </main>
  );
}
