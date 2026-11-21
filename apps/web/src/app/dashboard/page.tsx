"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type CurrentUser = { userId: string; fullName: string; email: string; roles: string[] };
type Report = {
  reportId: string; status: string; priority: string; description: string;
  areaId: string; areaName: string; zoneName: string; categoryName: string;
};
type Task = {
  taskId: string; title: string; status: string; priority: string;
  areaName: string; zoneName: string;
  latestSubmissionId?: string | null; latestSubmissionStatus?: string | null;
};
type Category = { categoryId: number; name: string };

async function apiRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "The request could not be completed.");
  return payload.data;
}

function EvidenceForm({ taskId, categories, onDone }: { taskId: string; categories: Category[]; onDone: () => void }) {
  const [categoryId,setCategoryId] = useState(String(categories[0]?.categoryId ?? ""));
  const [weight,setWeight] = useState("");
  const [method,setMethod] = useState("weighing_scale");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest("/tasks/"+taskId+"/submissions", {
        method: "POST",
        body: JSON.stringify({
          records: [{
            categoryId: Number(categoryId),
            enteredWeight: Number(weight),
            enteredUnit: "kg",
            measurementMethod: method
          }]
        })
      });
      setWeight("");
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submission failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inlineEvidence" onSubmit={submit}>
      <label>Waste category
        <select required value={categoryId} onChange={event=>setCategoryId(event.target.value)}>
          {categories.map(category=><option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
        </select>
      </label>
      <label>Collected weight (kg)
        <input type="number" min="0.001" step="0.001" required value={weight} onChange={event=>setWeight(event.target.value)} placeholder="e.g. 2.500" />
      </label>
      <label>Measurement method
        <select value={method} onChange={event=>setMethod(event.target.value)}>
          <option value="weighing_scale">Weighing scale</option>
          <option value="estimated">Estimated</option>
          <option value="count_converted">Count converted</option>
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="primaryButton" disabled={saving || categories.length===0}>{saving ? "Submitting…" : "Submit evidence"}</button>
    </form>
  );
}


type AssignableUser = { userId: string; fullName: string; email: string };
type Team = { teamId: string; name: string; code: string; activeMemberCount: number };

function TeamCreateForm({ users, onDone }: { users: AssignableUser[]; onDone: () => void }) {
  const [name,setName] = useState("");
  const [code,setCode] = useState("");
  const [lead,setLead] = useState("");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await apiRequest("/teams",{method:"POST",body:JSON.stringify({name,code,...(lead?{teamLeadUserId:lead}:{})})});
      setName(""); setCode(""); setLead(""); onDone();
    } catch(cause) { setError(cause instanceof Error?cause.message:"Team creation failed."); }
    finally { setSaving(false); }
  }
  return <form className="teamForm" onSubmit={submit}>
    <strong>Create a cleaning team</strong>
    <input required minLength={2} maxLength={100} value={name} onChange={event=>setName(event.target.value)} placeholder="Team name" />
    <input required minLength={2} maxLength={40} value={code} onChange={event=>setCode(event.target.value)} placeholder="Team code" />
    <select value={lead} onChange={event=>setLead(event.target.value)}>
      <option value="">No team lead yet</option>
      {users.map(user=><option key={user.userId} value={user.userId}>{user.fullName}</option>)}
    </select>
    {error?<p className="error">{error}</p>:null}
    <button className="secondaryButton" disabled={saving}>{saving?"Creating…":"Create team"}</button>
  </form>;
}

function TeamMemberForm({ team, users, onDone }: { team: Team; users: AssignableUser[]; onDone: () => void }) {
  const [userId,setUserId] = useState("");
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!userId)return; setSaving(true); setError("");
    try {
      await apiRequest("/teams/"+team.teamId+"/members",{method:"POST",body:JSON.stringify({userId,memberRole:"volunteer"})});
      setUserId(""); onDone();
    } catch(cause) { setError(cause instanceof Error?cause.message:"Could not add team member."); }
    finally { setSaving(false); }
  }
  return <form className="memberForm" onSubmit={submit}>
    <select required value={userId} onChange={event=>setUserId(event.target.value)}>
      <option value="">Add a volunteer…</option>
      {users.map(user=><option key={user.userId} value={user.userId}>{user.fullName}</option>)}
    </select>
    <button className="secondaryButton" disabled={saving || !userId}>{saving?"Adding…":"Add member"}</button>
    {error?<span className="error">{error}</span>:null}
  </form>;
}

function TaskAssignmentForm({ taskId, users, teams, onDone }: { taskId: string; users: AssignableUser[]; teams: Team[]; onDone: () => void }) {
  const [kind,setKind] = useState<"user"|"team">("team");
  const [target,setTarget] = useState("");
  const [replace,setReplace] = useState(false);
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const options = kind==="team" ? teams.map(team=>({id:team.teamId,label:team.name})) : users.map(user=>({id:user.userId,label:user.fullName}));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!target)return; setSaving(true); setError("");
    try {
      await apiRequest("/tasks/"+taskId+"/assignments",{method:"POST",body:JSON.stringify({
        ...(kind==="team"?{teamId:target}:{userId:target}),replaceExisting:replace
      })});
      setTarget(""); setReplace(false); onDone();
    } catch(cause) { setError(cause instanceof Error?cause.message:"Assignment failed."); }
    finally { setSaving(false); }
  }
  return <form className="assignmentForm" onSubmit={submit}>
    <select value={kind} onChange={event=>{setKind(event.target.value as "user"|"team");setTarget("");}}>
      <option value="team">Assign team</option><option value="user">Assign individual</option>
    </select>
    <select required value={target} onChange={event=>setTarget(event.target.value)}>
      <option value="">Choose {kind}</option>
      {options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    <label className="checkLabel"><input type="checkbox" checked={replace} onChange={event=>setReplace(event.target.checked)} /> Replace current assignments</label>
    <button className="secondaryButton" disabled={saving || !target}>{saving?"Assigning…":"Assign"}</button>
    {error?<span className="error">{error}</span>:null}
  </form>;
}


type Notification = { notificationId: string; title: string; body: string; readAt: string | null; createdAt: string };
type Announcement = { announcementId: string; title: string; body: string; audience: string; publishedAt: string };
type Analytics = {
  reportCounts: { status: string; count: number }[];
  taskCounts: { status: string; count: number }[];
  verifiedWeights: { categoryName: string; weightKg: number; recordCount: number }[];
  destinationWeights: { destinationType: string; weightKg: number }[];
  remainingWeightKg: number;
  reportsByZone: { zoneName: string; reportCount: number }[];
};

function AnnouncementForm({ onDone }: { onDone: () => void }) {
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    try{
      await apiRequest("/announcements",{method:"POST",body:JSON.stringify({title,body,audience:"all_users"})});
      setTitle("");setBody("");onDone();
    }catch(cause){setError(cause instanceof Error?cause.message:"Announcement failed.");}
    finally{setSaving(false);}
  }
  return <form className="announcementForm" onSubmit={submit}>
    <strong>Publish an announcement</strong>
    <input required minLength={3} maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Announcement title" />
    <textarea required minLength={3} maxLength={5000} rows={3} value={body} onChange={event=>setBody(event.target.value)} placeholder="Write an update for all fest users…" />
    {error?<p className="error">{error}</p>:null}
    <button className="primaryButton" disabled={saving}>{saving?"Publishing…":"Publish to everyone"}</button>
  </form>;
}


type LocationData = {
  zones: {zoneId:string;code:string;name:string;isActive:boolean}[];
  areas: {areaId:string;zoneId:string;code:string;name:string;isActive:boolean}[];
  bins: {binId:string;areaId:string;code:string;capacityKg:number|null;categoryName:string|null;isActive:boolean}[];
};

function LocationManager({locations,categories,onDone}:{locations:LocationData;categories:Category[];onDone:()=>void}){
  const [zoneCode,setZoneCode]=useState(""); const [zoneName,setZoneName]=useState("");
  const [areaZone,setAreaZone]=useState(""); const [areaCode,setAreaCode]=useState(""); const [areaName,setAreaName]=useState("");
  const [binArea,setBinArea]=useState(""); const [binCode,setBinCode]=useState(""); const [binCategory,setBinCategory]=useState(""); const [capacity,setCapacity]=useState("");
  const [categoryCode,setCategoryCode]=useState(""); const [categoryName,setCategoryName]=useState(""); const [recyclable,setRecyclable]=useState(false);
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  async function run(path:string,body:unknown){
    setSaving(true);setError("");
    try{await apiRequest(path,{method:"POST",body:JSON.stringify(body)});onDone();}
    catch(cause){setError(cause instanceof Error?cause.message:"Location update failed.");}
    finally{setSaving(false);}
  }
  return <section className="workspaceSection">
    <div className="sectionHeading"><div><div className="eyebrow">Fest configuration</div><h2>Zones, areas, bins & categories</h2></div></div>
    <div className="locationForms">
      <form className="formCard" onSubmit={event=>{event.preventDefault();void run("/zones",{code:zoneCode,name:zoneName});setZoneCode("");setZoneName("");}}>
        <h3>Add zone</h3><input required value={zoneCode} onChange={e=>setZoneCode(e.target.value)} placeholder="Zone code"/>
        <input required value={zoneName} onChange={e=>setZoneName(e.target.value)} placeholder="Zone name"/>
        <button className="secondaryButton" disabled={saving}>Create zone</button>
      </form>
      <form className="formCard" onSubmit={event=>{event.preventDefault();void run("/areas",{zoneId:areaZone,code:areaCode,name:areaName});setAreaCode("");setAreaName("");}}>
        <h3>Add area</h3><select required value={areaZone} onChange={e=>setAreaZone(e.target.value)}><option value="">Choose zone</option>{locations.zones.filter(z=>z.isActive).map(z=><option key={z.zoneId} value={z.zoneId}>{z.name}</option>)}</select>
        <input required value={areaCode} onChange={e=>setAreaCode(e.target.value)} placeholder="Area code"/>
        <input required value={areaName} onChange={e=>setAreaName(e.target.value)} placeholder="Area name"/>
        <button className="secondaryButton" disabled={saving || !areaZone}>Create area</button>
      </form>
      <form className="formCard" onSubmit={event=>{event.preventDefault();void run("/bins",{areaId:binArea,code:binCode,...(binCategory?{categoryId:Number(binCategory)}:{}),...(capacity?{capacityKg:Number(capacity)}:{})});setBinCode("");setCapacity("");}}>
        <h3>Add bin</h3><select required value={binArea} onChange={e=>setBinArea(e.target.value)}><option value="">Choose area</option>{locations.areas.filter(a=>a.isActive).map(a=><option key={a.areaId} value={a.areaId}>{a.name}</option>)}</select>
        <input required value={binCode} onChange={e=>setBinCode(e.target.value)} placeholder="Bin code"/>
        <select value={binCategory} onChange={e=>setBinCategory(e.target.value)}><option value="">Any category</option>{categories.map(c=><option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select>
        <input type="number" min="0.01" step="0.01" value={capacity} onChange={e=>setCapacity(e.target.value)} placeholder="Capacity kg (optional)"/>
        <button className="secondaryButton" disabled={saving || !binArea}>Create bin</button>
      </form>
      <form className="formCard" onSubmit={event=>{event.preventDefault();void run("/waste-categories",{code:categoryCode,name:categoryName,isRecyclable:recyclable});setCategoryCode("");setCategoryName("");}}>
        <h3>Add waste category</h3><input required value={categoryCode} onChange={e=>setCategoryCode(e.target.value)} placeholder="Category code"/>
        <input required value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="Category name"/>
        <label className="checkLabel"><input type="checkbox" checked={recyclable} onChange={e=>setRecyclable(e.target.checked)}/> Recyclable material</label>
        <button className="secondaryButton" disabled={saving}>Create category</button>
      </form>
    </div>
    {error?<p className="error">{error}</p>:null}
    <div className="locationInventory">
      <article className="panel"><h3>Zones & areas</h3>{locations.zones.map(zone=><div className="inventoryLine" key={zone.zoneId}><strong>{zone.name}</strong><span>{zone.code} · {zone.isActive?"Active":"Inactive"}</span></div>)}{locations.areas.map(area=><div className="inventoryLine nested" key={area.areaId}><span>{area.name}</span><span>{area.code} · {area.isActive?"Active":"Inactive"}</span></div>)}</article>
      <article className="panel"><h3>Bins</h3>{locations.bins.length===0?<p className="muted">No bins configured.</p>:locations.bins.map(bin=><div className="inventoryLine" key={bin.binId}><strong>{bin.code}</strong><span>{bin.categoryName??"Uncategorized"} · {bin.capacityKg??"—"} kg · {bin.isActive?"Active":"Inactive"}</span></div>)}</article>
    </div>
  </section>;
}


type AdminUser = { userId:string; fullName:string; email:string; status:string; roles:string[] };
type Role = { roleId:number; roleKey:string; displayName:string };

function UserAdmin({users,roles,onDone}:{users:AdminUser[];roles:Role[];onDone:()=>void}){
  const [fullName,setFullName]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [roleIds,setRoleIds]=useState<number[]>([]);
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  async function createUser(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError("");
    try{
      await apiRequest("/users",{method:"POST",body:JSON.stringify({fullName,email,password,roleIds})});
      setFullName("");setEmail("");setPassword("");setRoleIds([]);onDone();
    }catch(cause){setError(cause instanceof Error?cause.message:"User creation failed.");}
    finally{setSaving(false);}
  }
  async function changeStatus(user:AdminUser){
    const status=user.status==="active"?"suspended":"active";
    if(!window.confirm((status==="suspended"?"Suspend ":"Reactivate ")+user.fullName+"?"))return;
    setSaving(true);setError("");
    try{await apiRequest("/users/"+user.userId+"/status",{method:"PATCH",body:JSON.stringify({status})});onDone();}
    catch(cause){setError(cause instanceof Error?cause.message:"Account update failed.");}
    finally{setSaving(false);}
  }
  return <section className="workspaceSection">
    <div className="sectionHeading"><div><div className="eyebrow">Access control</div><h2>User accounts</h2></div><span className="countPill">{users.length}</span></div>
    <form className="formCard userCreateForm" onSubmit={createUser}>
      <h3>Create staff account</h3>
      <input required minLength={2} maxLength={120} value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name"/>
      <input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address"/>
      <input type="password" required minLength={14} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Temporary password (14+ characters)"/>
      <strong>Assign roles</strong>
      <div className="roleCheckboxes">{roles.map(role=><label key={role.roleId}><input type="checkbox" checked={roleIds.includes(role.roleId)} onChange={e=>setRoleIds(current=>e.target.checked?[...current,role.roleId]:current.filter(id=>id!==role.roleId))}/>{role.displayName}</label>)}</div>
      {error?<p className="error">{error}</p>:null}
      <button className="primaryButton" disabled={saving || roleIds.length===0}>{saving?"Creating…":"Create account"}</button>
    </form>
    {users.map(user=><article className="workCard userRow" key={user.userId}>
      <div><strong>{user.fullName}</strong><p className="muted">{user.email}</p><div className="roleList">{user.roles.map(role=><span className="rolePill" key={role}>{role.replaceAll("_"," ")}</span>)}</div></div>
      <div className="userActions"><span className={"statusPill status-"+user.status}>{user.status}</span><button className="secondaryButton" disabled={saving} onClick={()=>void changeStatus(user)}>{user.status==="active"?"Suspend":"Reactivate"}</button></div>
    </article>)}
  </section>;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user,setUser] = useState<CurrentUser | null>(null);
  const [reports,setReports] = useState<Report[]>([]);
  const [tasks,setTasks] = useState<Task[]>([]);
  const [categories,setCategories] = useState<Category[]>([]);
  const [assignableUsers,setAssignableUsers] = useState<AssignableUser[]>([]);
  const [teams,setTeams] = useState<Team[]>([]);
  const [notifications,setNotifications] = useState<Notification[]>([]);
  const [announcements,setAnnouncements] = useState<Announcement[]>([]);
  const [analytics,setAnalytics] = useState<Analytics | null>(null);
  const [locations,setLocations] = useState<LocationData>({zones:[],areas:[],bins:[]});\n  const [adminUsers,setAdminUsers] = useState<AdminUser[]>([]);\n  const [roles,setRoles] = useState<Role[]>([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [workingId,setWorkingId] = useState("");

  const loadData = useCallback(async () => {
    const me = await apiRequest("/auth/me");
    const current = me.user as CurrentUser;
    setUser(current);
    const isManager = current.roles.some(role=>["administrator","waste_manager","fest_organizer"].includes(role));
    const canWork = current.roles.some(role=>["administrator","waste_manager","team_lead","volunteer"].includes(role));
    const canManage = current.roles.some(role=>["administrator","waste_manager"].includes(role));
    const canSeeAnalytics = current.roles.some(role=>["administrator","waste_manager","fest_organizer"].includes(role));
    const [reportPayload,taskPayload,optionsPayload,userPayload,teamPayload,notificationPayload,announcementPayload,analyticsPayload,locationPayload,adminUserPayload,rolePayload] = await Promise.all([
      isManager ? apiRequest("/reports?pageSize=30") : Promise.resolve([]),
      canWork ? apiRequest("/tasks?pageSize=30") : Promise.resolve([]),
      canWork ? apiRequest("/public/form-options") : Promise.resolve({categories:[]}),
      canManage ? apiRequest("/users/assignable") : Promise.resolve([]),
      canManage ? apiRequest("/teams") : Promise.resolve([]),
      apiRequest("/notifications"),
      apiRequest("/announcements"),
      canSeeAnalytics ? apiRequest("/analytics/overview") : Promise.resolve(null)
    ]);
    setReports(reportPayload ?? []);
    setTasks(taskPayload ?? []);
    setCategories(optionsPayload.categories ?? []);
    setAssignableUsers(userPayload ?? []);
    setTeams(teamPayload ?? []);
    setNotifications(notificationPayload ?? []);
    setAnnouncements(announcementPayload ?? []);
    setAnalytics(analyticsPayload ?? null);
    setLocations(locationPayload ?? {zones:[],areas:[],bins:[]});\n    setAdminUsers(adminUserPayload ?? []);\n    setRoles(rolePayload ?? []);
  },[]);

  useEffect(() => {
    let cancelled=false;
    loadData()
      .catch(cause=>{
        if(cancelled)return;
        if(cause instanceof Error && cause.message.toLowerCase().includes("sign in")) router.replace("/login");
        else setError(cause instanceof Error?cause.message:"Unable to load the workspace.");
      })
      .finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[loadData,router]);

  async function perform(id: string, action: ()=>Promise<unknown>) {
    setWorkingId(id);
    setError("");
    try { await action(); await loadData(); }
    catch(cause) { setError(cause instanceof Error?cause.message:"The action failed."); }
    finally { setWorkingId(""); }
  }


  async function markNotificationRead(notificationId: string) {
    await perform(notificationId,()=>apiRequest("/notifications/"+notificationId+"/read",{method:"POST"}));
  }

  async function downloadCsv(type: "reports"|"tasks"|"collections") {
    try {
      const response = await fetch(API+"/analytics/export.csv?type="+type,{credentials:"include"});
      if(!response.ok) throw new Error("CSV export is unavailable.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href=url;
      anchor.download="baust-cse-fest-"+type+".csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Export failed.");
    }
  }

  async function signOut() {
    try { await apiRequest("/auth/logout",{method:"POST"}); } finally { router.replace("/login"); }
  }

  if(loading)return <main className="authPage"><p>Checking your session…</p></main>;
  if(error && !user)return <main className="authPage"><p className="error">{error}</p><a href="/login">Return to sign in</a></main>;
  if(!user)return <main className="authPage"><p>Redirecting to sign in…</p></main>;

  const isManager = user.roles.some(role=>["administrator","waste_manager"].includes(role));
  const canViewReports = user.roles.some(role=>["administrator","waste_manager","fest_organizer"].includes(role));
  const canReviewReports = isManager;
  const canManageTasks = isManager;
  const canExecuteTasks = user.roles.some(role=>["team_lead","volunteer"].includes(role));

  return (
    <main className="dashboardPage">
      <header className="dashboardHeader">
        <a className="authBrand" href="/">BAUST <span>GREEN</span> / CSE FEST</a>
        <div className="dashboardActions"><span className="muted">{user.fullName}</span><button className="secondaryButton" onClick={signOut}>Sign out</button></div>
      </header>
      <section className="dashboardWelcome">
        <div className="eyebrow">Staff workspace</div>
        <h1>Welcome, {user.fullName}.</h1>
        <p className="muted">{user.email}</p>
        <div className="roleList">{user.roles.map(role=><span className="rolePill" key={role}>{role.replaceAll("_"," ")}</span>)}</div>
        {error ? <p className="error" role="alert">{error}</p> : null}


        {user.roles.includes("administrator") ? <UserAdmin users={adminUsers} roles={roles} onDone={()=>void loadData()} /> : null}\n        {canManageTasks ? <LocationManager locations={locations} categories={categories} onDone={()=>void loadData()} /> : null}

        {analytics ? <section className="workspaceSection">
          <div className="sectionHeading"><div><div className="eyebrow">Live database metrics</div><h2>Fest overview</h2></div></div>
          <div className="metricGrid">
            <article className="metricCard"><span>Reports</span><strong>{analytics.reportCounts.reduce((sum,item)=>sum+Number(item.count),0)}</strong></article>
            <article className="metricCard"><span>Collection tasks</span><strong>{analytics.taskCounts.reduce((sum,item)=>sum+Number(item.count),0)}</strong></article>
            <article className="metricCard"><span>Verified collected</span><strong>{analytics.verifiedWeights.reduce((sum,item)=>sum+Number(item.weightKg),0).toFixed(3)} kg</strong></article>
            <article className="metricCard"><span>Awaiting processing</span><strong>{Number(analytics.remainingWeightKg).toFixed(3)} kg</strong></article>
          </div>
          <div className="analyticsColumns">
            <article className="panel"><h3>Verified weight by category</h3>{analytics.verifiedWeights.map(item=><p className="metricLine" key={item.categoryName}><span>{item.categoryName}</span><strong>{Number(item.weightKg).toFixed(3)} kg</strong></p>)}</article>
            <article className="panel"><h3>Processing destinations</h3>{analytics.destinationWeights.map(item=><p className="metricLine" key={item.destinationType}><span>{item.destinationType}</span><strong>{Number(item.weightKg).toFixed(3)} kg</strong></p>)}{analytics.destinationWeights.length===0?<p className="muted">No processing allocations recorded yet.</p>:null}</article>
          </div>
          <div className="buttonRow"><button className="secondaryButton" onClick={()=>void downloadCsv("reports")}>Export reports CSV</button><button className="secondaryButton" onClick={()=>void downloadCsv("tasks")}>Export tasks CSV</button><button className="secondaryButton" onClick={()=>void downloadCsv("collections")}>Export verified collections CSV</button></div>
        </section> : null}

        {canManageTasks ? <section className="workspaceSection">
          <div className="sectionHeading"><div><div className="eyebrow">Workforce</div><h2>Teams</h2></div><span className="countPill">{teams.length}</span></div>
          <TeamCreateForm users={assignableUsers} onDone={()=>void loadData()} />
          {teams.map(team=><article className="workCard teamCard" key={team.teamId}>
            <div className="workCardTop"><strong>{team.name}</strong><span className="muted">{team.activeMemberCount} active members</span></div>
            <small className="muted">{team.code}</small>
            <TeamMemberForm team={team} users={assignableUsers} onDone={()=>void loadData()} />
          </article>)}
        </section> : null}

        <section className="workspaceSection">
          <div className="sectionHeading"><div><div className="eyebrow">Fest updates</div><h2>Announcements</h2></div><span className="countPill">{announcements.length}</span></div>
          {canManageTasks ? <AnnouncementForm onDone={()=>void loadData()} /> : null}
          {announcements.length===0?<p className="emptyState">No active announcements.</p>:announcements.map(item=><article className="workCard" key={item.announcementId}><strong>{item.title}</strong><p>{item.body}</p><small className="muted">{item.audience.replaceAll("_"," ")} · {new Date(item.publishedAt).toLocaleString()}</small></article>)}
        </section>

        <section className="workspaceSection">
          <div className="sectionHeading"><div><div className="eyebrow">Personal updates</div><h2>Notifications</h2></div><span className="countPill">{notifications.filter(item=>!item.readAt).length} unread</span></div>
          {notifications.length===0?<p className="emptyState">You have no notifications.</p>:notifications.map(item=><article className={"notificationCard "+(item.readAt?"read":"unread")} key={item.notificationId}>
            <div><strong>{item.title}</strong><p>{item.body}</p><small className="muted">{new Date(item.createdAt).toLocaleString()}</small></div>
            {!item.readAt?<button className="secondaryButton" onClick={()=>void markNotificationRead(item.notificationId)}>Mark read</button>:null}
          </article>)}
        </section>

        {canViewReports ? (
          <section className="workspaceSection">
            <div className="sectionHeading"><div><div className="eyebrow">Incoming reports</div><h2>Waste reports</h2></div><span className="countPill">{reports.length}</span></div>
            {reports.length===0 ? <p className="emptyState">No reports match the current view.</p> : reports.map(report=>(
              <article className="workCard" key={report.reportId}>
                <div className="workCardTop"><strong>{report.categoryName}</strong><span className={"statusPill status-"+report.status}>{report.status.replaceAll("_"," ")}</span></div>
                <p className="muted">{report.zoneName} · {report.areaName} · {report.priority} priority</p>
                <p>{report.description}</p>
                <small className="muted">Report {report.reportId}</small>
                <div className="buttonRow">
                  {canReviewReports && report.status==="submitted" ? <button className="secondaryButton" disabled={workingId===report.reportId} onClick={()=>perform(report.reportId,()=>apiRequest("/reports/"+report.reportId+"/start-review",{method:"POST"}))}>Start review</button> : null}
                  {canReviewReports && report.status==="under_review" ? <>
                    <button className="primaryButton" disabled={workingId===report.reportId} onClick={()=>perform(report.reportId,()=>apiRequest("/reports/"+report.reportId+"/review",{method:"POST",body:JSON.stringify({action:"accept"})}))}>Accept report</button>
                    <button className="dangerButton" disabled={workingId===report.reportId} onClick={()=>{const reason=window.prompt("Why is this report being rejected?");if(reason?.trim())void perform(report.reportId,()=>apiRequest("/reports/"+report.reportId+"/review",{method:"POST",body:JSON.stringify({action:"reject",reason})}));}}>Reject</button>
                  </> : null}
                  {canManageTasks && report.status==="accepted" ? <button className="primaryButton" disabled={workingId===report.reportId} onClick={()=>perform(report.reportId,()=>apiRequest("/tasks",{method:"POST",body:JSON.stringify({areaId:report.areaId,reportId:report.reportId,title:"Collect waste: "+report.categoryName,priority:report.priority})}))}>Create collection task</button> : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {user.roles.some(role=>["administrator","waste_manager","team_lead","volunteer"].includes(role)) ? (
          <section className="workspaceSection">
            <div className="sectionHeading"><div><div className="eyebrow">Operations</div><h2>Collection tasks</h2></div><span className="countPill">{tasks.length}</span></div>
            {tasks.length===0 ? <p className="emptyState">No tasks are assigned or available in your permitted view.</p> : tasks.map(task=>(
              <article className="workCard" key={task.taskId}>
                <div className="workCardTop"><strong>{task.title}</strong><span className={"statusPill status-"+task.status}>{task.status.replaceAll("_"," ")}</span></div>
                <p className="muted">{task.zoneName} · {task.areaName} · {task.priority} priority</p>
                <small className="muted">Task {task.taskId}</small>
                <div className="buttonRow">
                  {canExecuteTasks && task.status==="assigned" ? <button className="primaryButton" disabled={workingId===task.taskId} onClick={()=>perform(task.taskId,()=>apiRequest("/tasks/"+task.taskId+"/start",{method:"POST"}))}>Start task</button> : null}
                  {canExecuteTasks && task.status==="in_progress" ? <EvidenceForm taskId={task.taskId} categories={categories} onDone={()=>void loadData()}/> : null}
                  {canManageTasks && ["open","assigned"].includes(task.status) ? <TaskAssignmentForm taskId={task.taskId} users={assignableUsers} teams={teams} onDone={()=>void loadData()} /> : null}
                  {canManageTasks && task.status==="submitted_for_verification" && task.latestSubmissionId ? <>
                    <button className="primaryButton" disabled={workingId===task.taskId} onClick={()=>perform(task.taskId,()=>apiRequest("/collection-submissions/"+task.latestSubmissionId+"/decision",{method:"POST",body:JSON.stringify({decision:"verify"})}))}>Verify collection</button>
                    <button className="dangerButton" disabled={workingId===task.taskId} onClick={()=>{const reason=window.prompt("What needs correction?");if(reason?.trim())void perform(task.taskId,()=>apiRequest("/collection-submissions/"+task.latestSubmissionId+"/decision",{method:"POST",body:JSON.stringify({decision:"reject",reason})}));}}>Reject evidence</button>
                  </> : null}
                  {canManageTasks && task.status==="in_progress" ? <button className="secondaryButton" disabled={workingId===task.taskId} onClick={()=>{const reason=window.prompt("Explain why no waste was found or why this task can be closed.");if(reason?.trim())void perform(task.taskId,()=>apiRequest("/tasks/"+task.taskId+"/close-no-waste",{method:"POST",body:JSON.stringify({reason})}));}}>Close as no-waste</button> : null}
                  {canManageTasks && !["verified","cancelled"].includes(task.status) ? <button className="dangerButton" disabled={workingId===task.taskId} onClick={()=>{const reason=window.prompt("Why is this task being cancelled?");if(reason?.trim())void perform(task.taskId,()=>apiRequest("/tasks/"+task.taskId+"/cancel",{method:"POST",body:JSON.stringify({reason})}));}}>Cancel task</button> : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </section>
    </main>
  );
}
