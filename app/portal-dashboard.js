"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/app/lib/firebase";
import BrandLogo from "@/app/brand-logo";

const allowedRoles = {
  admin: ["sub_admin", "senior_technical", "jn_technical"],
  sub_admin: ["senior_technical", "jn_technical"],
  senior_technical: ["jn_technical"],
  jn_technical: [],
};
const employeePermissions = [
  "manage_employees",
  "manage_permissions",
  "manage_lower_employees",
  "manage_junior_employees",
  "manage_clients",
  "manage_assignments",
];
const labels = {
  admin: "Admin",
  sub_admin: "Sub Admin",
  senior_technical: "Senior Technical",
  jn_technical: "JN Technical",
};
const rolePath = {
  admin: "admin",
  sub_admin: "sub-admin",
  senior_technical: "senior-technical",
  jn_technical: "jn-technical",
};

function PasswordField({
  label,
  value,
  onChange,
  minLength = 8,
  required = true,
  autoComplete,
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <label>
      {label}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid #dfe3ea",
          borderRadius: 10,
          background: "#fff",
          padding: "0 10px",
        }}
      >
        <input
          type={showPassword ? "text" : "password"}
          minLength={minLength}
          required={required}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            flex: 1,
            padding: "12px 0",
          }}
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#374151",
            fontSize: 14,
            fontWeight: 600,
            padding: 0,
          }}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

export default function PortalDashboard({ session }) {
  const router = useRouter();
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: allowedRoles[session.role][0] || "",
    password: "",
    status: "active",
  });
  const [clientForm, setClientForm] = useState({
    name: "",
    provider: "",
    assignedTo: "",
  });
  const [assignments, setAssignments] = useState({});
  const [roleDrafts, setRoleDrafts] = useState({});
  const [permissionDrafts, setPermissionDrafts] = useState({});
  const [selectedEmployeeUid, setSelectedEmployeeUid] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const canManageEmployees =
    allowedRoles[session.role].length > 0 &&
    [
      "manage_employees",
      "manage_lower_employees",
      "manage_junior_employees",
    ].some((permission) => session.permissions.includes(permission));
  const canAssignClients =
    allowedRoles[session.role].length > 0 &&
    session.permissions.includes("manage_assignments");

  useEffect(
    () => onAuthStateChanged(auth, (user) => setFirebaseUser(user)),
    [],
  );

  useEffect(() => {
    if (!firebaseUser) return undefined;
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const token = await firebaseUser.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const [employeeResponse, clientResponse] = await Promise.all([
          canManageEmployees || canAssignClients
            ? fetch("/api/employees", { headers, cache: "no-store" })
            : Promise.resolve(null),
          fetch("/api/clients", { headers, cache: "no-store" }),
        ]);
        const employeeResult = employeeResponse
          ? await employeeResponse.json()
          : { employees: [] };
        const clientResult = await clientResponse.json();
        if (employeeResponse && !employeeResponse.ok)
          throw new Error(employeeResult.error);
        if (!clientResponse.ok) throw new Error(clientResult.error);
        if (!cancelled) {
          setEmployees(employeeResult.employees);
          setClients(clientResult.clients);
        }
      } catch (loadError) {
        if (!cancelled)
          setError(
            loadError.message || "Could not load authorized CRM records.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, canAssignClients, canManageEmployees]);

  async function apiRequest(path, method, body) {
    if (!firebaseUser)
      throw new Error("Your sign-in has expired. Please sign in again.");
    const token = await firebaseUser.getIdToken(true);
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request was rejected.");
    return result;
  }

  async function createEmployee(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/employees", "POST", form);
      setForm({
        name: "",
        email: "",
        phone: "",
        role: allowedRoles[session.role][0],
        password: "",
        status: "active",
      });
      const result = await apiRequest("/api/employees", "GET");
      setEmployees(result.employees);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(employee, status) {
    setError("");
    try {
      await apiRequest("/api/employees", "PATCH", {
        uid: employee.uid,
        status,
      });
      setEmployees((current) =>
        current.map((item) =>
          item.uid === employee.uid ? { ...item, status } : item,
        ),
      );
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function updateEmployee(employee, changes) {
    setError("");
    try {
      const result = await apiRequest("/api/employees", "PATCH", {
        uid: employee.uid,
        ...changes,
      });
      setEmployees((current) =>
        current.map((item) =>
          item.uid === employee.uid ? { ...item, ...result } : item,
        ),
      );
      if (changes.name || changes.email || changes.phone)
        setProfileForm((current) => ({ ...current, ...changes }));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function transferClient(client) {
    setError("");
    try {
      await apiRequest("/api/clients", "PATCH", {
        clientId: client.id,
        assignedTo: assignments[client.id],
      });
      const result = await apiRequest("/api/clients", "GET");
      setClients(result.clients);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createClient(event) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest("/api/clients", "POST", clientForm);
      setClientForm({ name: "", provider: "", assignedTo: "" });
      const result = await apiRequest("/api/clients", "GET");
      setClients(result.clients);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    await signOut(auth);
    router.replace("/login");
  }

  const assignableEmployees = canAssignClients
    ? employees.filter(
        (employee) =>
          employee.status === "active" &&
          allowedRoles[session.role].includes(employee.role),
      )
    : [];
  const selectedEmployee = employees.find(
    (employee) => employee.uid === selectedEmployeeUid,
  );
  const initials = session.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo />
          <div>
            <strong>
              Professional
              <br />
              Tax Partner
            </strong>
            <span>Consultant CRM</span>
          </div>
        </div>
        <div className="workspace-label">Workspace</div>
        <nav className="nav-list" aria-label="Portal navigation">
          <a
            className="nav-item active"
            href={`/${rolePath[session.role]}/dashboard`}
          >
            <span>Dashboard</span>
          </a>
          {canManageEmployees && (
            <a className="nav-item" href="#employees">
              <span>Employees</span>
            </a>
          )}
          <a className="nav-item" href="#clients">
            <span>Client assignments</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini">
            <div className="avatar avatar-teal">{initials}</div>
            <div>
              <strong>{session.name}</strong>
              <span>{session.roleLabel}</span>
            </div>
            <button className="logout-button" onClick={logout}>
              Log out
            </button>
          </div>
        </div>
      </aside>
      <section className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <strong>{session.roleLabel} portal</strong>
          </div>
          <div className="top-actions">
            <div className="secure-tag">
              <span className="secure-dot" /> Verified account
            </div>
            <div className="top-avatar">{initials}</div>
          </div>
        </header>
        <div className="content-wrap">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">{session.email}</p>
              <h1>{session.roleLabel} dashboard</h1>
              <p className="subheading">Signed in as {session.name}</p>
            </div>
          </div>
          {error && (
            <div className="empty-state" role="alert">
              {error}
            </div>
          )}
          {canManageEmployees && (
            <section className="workspace-view" id="employees">
              <div className="workspace-header">
                <div>
                  <p className="eyebrow">Team access</p>
                  <h2>Employees</h2>
                  <p>
                    Only employees within your management hierarchy are shown.
                  </p>
                </div>
              </div>
              <div className="panel workspace-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Add employee</h2>
                    <p>New employees sign in through the common login page.</p>
                  </div>
                </div>
                <form
                  className="form-grid employee-form"
                  onSubmit={createEmployee}
                >
                  <label>
                    Full name
                    <input
                      required
                      value={form.name}
                      onChange={(event) =>
                        setForm({ ...form, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm({ ...form, email: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Phone
                    <input
                      required
                      type="tel"
                      value={form.phone}
                      onChange={(event) =>
                        setForm({ ...form, phone: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Role
                    <select
                      required
                      value={form.role}
                      onChange={(event) =>
                        setForm({ ...form, role: event.target.value })
                      }
                    >
                      {allowedRoles[session.role].map((role) => (
                        <option key={role} value={role}>
                          {labels[role]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <PasswordField
                    label="Temporary password"
                    value={form.password}
                    onChange={(event) =>
                      setForm({ ...form, password: event.target.value })
                    }
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <label>
                    Account status
                    <select
                      value={form.status}
                      onChange={(event) =>
                        setForm({ ...form, status: event.target.value })
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <div className="modal-actions">
                    <button className="primary-button" disabled={saving}>
                      {saving ? "Creating..." : "Create employee"}
                    </button>
                  </div>
                </form>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Created by</th>
                        <th>Permissions</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => (
                        <tr key={employee.uid}>
                          <td>
                            <strong>{employee.name}</strong>
                            <span className="record-id">
                              {employee.email} · {employee.phone}
                            </span>
                          </td>
                          <td>
                            {canManageEmployees ? (
                              <div className="employee-role-control">
                                <select
                                  aria-label={`Role for ${employee.name}`}
                                  value={
                                    roleDrafts[employee.uid] || employee.role
                                  }
                                  onChange={(event) =>
                                    setRoleDrafts({
                                      ...roleDrafts,
                                      [employee.uid]: event.target.value,
                                    })
                                  }
                                >
                                  {allowedRoles[session.role].map((role) => (
                                    <option key={role} value={role}>
                                      {labels[role]}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    updateEmployee(employee, {
                                      role:
                                        roleDrafts[employee.uid] ||
                                        employee.role,
                                    })
                                  }
                                >
                                  Save
                                </button>
                              </div>
                            ) : (
                              labels[employee.role]
                            )}
                          </td>
                          <td>{employee.status}</td>
                          <td>
                            {employee.createdBy === session.uid
                              ? "You"
                              : employee.createdBy}
                          </td>
                          <td>
                            {session.role === "admin" ? (
                              <details className="permissions-editor">
                                <summary>Edit</summary>
                                <div>
                                  {employeePermissions.map((permission) => (
                                    <label key={permission}>
                                      <input
                                        type="checkbox"
                                        checked={(
                                          permissionDrafts[employee.uid] ||
                                          employee.permissions ||
                                          []
                                        ).includes(permission)}
                                        onChange={(event) => {
                                          const current =
                                            permissionDrafts[employee.uid] ||
                                            employee.permissions ||
                                            [];
                                          const next = event.target.checked
                                            ? [...current, permission]
                                            : current.filter(
                                                (value) => value !== permission,
                                              );
                                          setPermissionDrafts({
                                            ...permissionDrafts,
                                            [employee.uid]: next,
                                          });
                                        }}
                                      />
                                      {permission.replaceAll("_", " ")}
                                    </label>
                                  ))}
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      updateEmployee(employee, {
                                        permissions:
                                          permissionDrafts[employee.uid] ||
                                          employee.permissions ||
                                          [],
                                      })
                                    }
                                  >
                                    Save permissions
                                  </button>
                                </div>
                              </details>
                            ) : (
                              (employee.permissions || []).join(", ") ||
                              "Role defaults"
                            )}
                          </td>
                          <td>
                            <button
                              className="secondary-button"
                              onClick={() =>
                                updateStatus(
                                  employee,
                                  employee.status === "active"
                                    ? "inactive"
                                    : "active",
                                )
                              }
                            >
                              {employee.status === "active"
                                ? "Deactivate"
                                : "Activate"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loading && employees.length === 0 && (
                    <div className="empty-state">
                      No employees are in your management scope.
                    </div>
                  )}
                </div>
                {employees.length > 0 && (
                  <form
                    className="form-grid employee-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (selectedEmployee)
                        updateEmployee(selectedEmployee, profileForm);
                    }}
                  >
                    <label>
                      Employee to edit
                      <select
                        required
                        value={selectedEmployeeUid}
                        onChange={(event) => {
                          const employee = employees.find(
                            (item) => item.uid === event.target.value,
                          );
                          setSelectedEmployeeUid(event.target.value);
                          setProfileForm({
                            name: employee?.name || "",
                            email: employee?.email || "",
                            phone: employee?.phone || "",
                          });
                        }}
                      >
                        <option value="">Choose employee</option>
                        {employees.map((employee) => (
                          <option key={employee.uid} value={employee.uid}>
                            {employee.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Full name
                      <input
                        required
                        value={profileForm.name}
                        onChange={(event) =>
                          setProfileForm({
                            ...profileForm,
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Email
                      <input
                        required
                        type="email"
                        value={profileForm.email}
                        onChange={(event) =>
                          setProfileForm({
                            ...profileForm,
                            email: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Phone
                      <input
                        required
                        type="tel"
                        value={profileForm.phone}
                        onChange={(event) =>
                          setProfileForm({
                            ...profileForm,
                            phone: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="modal-actions">
                      <button
                        className="primary-button"
                        disabled={!selectedEmployee}
                      >
                        Save employee details
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
          )}
          <section className="workspace-view" id="clients">
            <div className="workspace-header">
              <div>
                <p className="eyebrow">Assignment scope</p>
                <h2>Client assignments</h2>
                <p>
                  A transferred client is removed from the previous
                  assignee&apos;s access immediately.
                </p>
              </div>
            </div>
            <div className="panel workspace-panel">
              {canAssignClients && assignableEmployees.length > 0 && (
                <form
                  className="form-grid client-assignment-form"
                  onSubmit={createClient}
                >
                  <label>
                    Client name
                    <input
                      required
                      value={clientForm.name}
                      onChange={(event) =>
                        setClientForm({
                          ...clientForm,
                          name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Service
                    <input
                      required
                      value={clientForm.provider}
                      onChange={(event) =>
                        setClientForm({
                          ...clientForm,
                          provider: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Assign to
                    <select
                      required
                      value={clientForm.assignedTo}
                      onChange={(event) =>
                        setClientForm({
                          ...clientForm,
                          assignedTo: event.target.value,
                        })
                      }
                    >
                      <option value="">Choose employee</option>
                      {assignableEmployees.map((employee) => (
                        <option key={employee.uid} value={employee.uid}>
                          {employee.name} · {labels[employee.role]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="modal-actions">
                    <button className="primary-button">
                      Add and assign client
                    </button>
                  </div>
                </form>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Service</th>
                      <th>Assigned employee</th>
                      <th>Transfer to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr key={client.id}>
                        <td>
                          <strong>{client.name}</strong>
                          <span className="record-id">{client.id}</span>
                        </td>
                        <td>{client.provider || client.work || "-"}</td>
                        <td>
                          {client.assignedToName ||
                            employees.find(
                              (employee) => employee.uid === client.assignedTo,
                            )?.name ||
                            "Unassigned"}
                        </td>
                        <td>
                          {assignableEmployees.length > 0 ? (
                            <div className="assignment-control">
                              <select
                                aria-label={`Transfer ${client.name}`}
                                value={assignments[client.id] || ""}
                                onChange={(event) =>
                                  setAssignments({
                                    ...assignments,
                                    [client.id]: event.target.value,
                                  })
                                }
                              >
                                <option value="">Select employee</option>
                                {assignableEmployees.map((employee) => (
                                  <option
                                    key={employee.uid}
                                    value={employee.uid}
                                  >
                                    {employee.name} · {labels[employee.role]}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="secondary-button"
                                disabled={!assignments[client.id]}
                                onClick={() => transferClient(client)}
                              >
                                Transfer
                              </button>
                            </div>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && clients.length === 0 && (
                  <div className="empty-state">
                    No clients are assigned within your authorized scope.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
