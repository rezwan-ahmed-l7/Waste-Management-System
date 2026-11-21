"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export function LoginForm() {
  const router = useRouter();
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(API + "/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Sign-in failed.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="formCard loginCard" onSubmit={submit}>
      <h1>Staff sign in</h1>
      <p className="muted">Access is limited to accounts provisioned by the system administrator.</p>
      <label>Email address
        <input type="email" autoComplete="username" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} />
      </label>
      <label>Password
        <input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="primaryButton" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
      <a className="backLink" href="/">← Back to public reporting</a>
    </form>
  );
}
