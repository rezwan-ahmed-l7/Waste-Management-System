"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AdminSetupForm() {
  const router = useRouter();
  const [token,setToken] = useState("");
  const [name,setName] = useState("");
  const [password,setPassword] = useState("");
  const [confirm,setConfirm] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    if (value) window.history.replaceState(null,"",window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) { setError("This setup link is missing or has expired. Ask the system owner for a new setup link."); return; }
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/v1/admin/bootstrap", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-admin-bootstrap-token":token},
        credentials:"same-origin",
        body:JSON.stringify({fullName:name,email:"admin@gmail.com",password})
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Administrator setup failed.");
      setPassword(""); setConfirm(""); setToken("");
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Administrator setup failed.");
    } finally { setLoading(false); }
  }

  return <form className="formCard loginCard" onSubmit={submit}>
    <h1>Initial administrator setup</h1>
    <p className="muted">Create the first system administrator account. This one-time setup link can only be used once.</p>
    {!token ? <p className="error">Setup token not found. Open the complete private setup link.</p> : null}
    <label>Administrator email<input type="email" value="admin@gmail.com" readOnly /></label>
    <label>Full name<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} /></label>
    <label>Password<input type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
    <label>Confirm password<input type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} /></label>
    <p className="privacyNote">Use a unique password with at least 14 characters. It is sent directly to the API over HTTPS and stored only as an Argon2id hash.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="primaryButton" disabled={loading || !token}>{loading ? "Creating administrator…" : "Create administrator and sign in"}</button>
    <a className="backLink" href="/login">Already set up? Staff sign in</a>
  </form>;
}
