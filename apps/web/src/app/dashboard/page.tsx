"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
type CurrentUser = { userId: string; fullName: string; email: string; roles: string[] };

export default function DashboardPage() {
  const router = useRouter();
  const [user,setUser] = useState<CurrentUser | null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);

  useEffect(() => {
    let cancelled=false;
    fetch(API+"/auth/me",{credentials:"include"})
      .then(async response=>{
        if(response.status===401){router.replace("/login");return null;}
        const payload=await response.json();
        if(!response.ok) throw new Error(payload.error?.message ?? "Unable to load account.");
        return payload.data.user as CurrentUser;
      })
      .then(value=>{if(!cancelled && value)setUser(value);})
      .catch(cause=>{if(!cancelled)setError(cause instanceof Error?cause.message:"Unable to load account.");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[router]);

  async function signOut(){
    await fetch(API+"/auth/logout",{method:"POST",credentials:"include"});
    router.replace("/login");
    router.refresh();
  }

  if(loading)return <main className="authPage"><p>Checking your session…</p></main>;
  if(error)return <main className="authPage"><p className="error">{error}</p></main>;
  if(!user)return <main className="authPage"><p>Redirecting to sign in…</p></main>;

  return (
    <main className="dashboardPage">
      <header className="dashboardHeader">
        <a className="authBrand" href="/">BAUST <span>GREEN</span> / CSE FEST</a>
        <button className="secondaryButton" onClick={signOut}>Sign out</button>
      </header>
      <section className="dashboardWelcome">
        <div className="eyebrow">Staff workspace</div>
        <h1>Welcome, {user.fullName}.</h1>
        <p className="muted">{user.email}</p>
        <div className="roleList">{user.roles.map(role=><span className="rolePill" key={role}>{role.replaceAll("_"," ")}</span>)}</div>
        <div className="panel">
          <h2>Your workspace is connected.</h2>
          <p className="muted">Your authenticated session is active. Operational modules are being connected to the database in the next implementation slices. No placeholder statistics are shown.</p>
        </div>
      </section>
    </main>
  );
}
