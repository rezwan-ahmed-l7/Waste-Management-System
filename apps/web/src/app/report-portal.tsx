"use client";

import { useEffect, useState, type FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type FormOptions = {
  areas: { areaId: string; areaName: string; zoneName: string }[];
  categories: { categoryId: number; name: string }[];
};
type Submission = { reportId: string; trackingToken: string; submittedAt: string };
type PublicStatus = { report_id: string; status: string; submitted_at: string; updated_at: string };

export function ReportPortal() {
  const [options, setOptions] = useState<FormOptions>({ areas: [], categories: [] });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [areaId, setAreaId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterContact, setReporterContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [reportId, setReportId] = useState("");
  const [trackingToken, setTrackingToken] = useState("");
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [trackingError, setTrackingError] = useState("");
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/public/form-options`)
      .then(async response => {
        if (!response.ok) throw new Error("Could not load fest locations and waste categories.");
        return response.json() as Promise<{ data: FormOptions }>;
      })
      .then(payload => {
        if (!cancelled) {
          setOptions(payload.data);
          setAreaId(payload.data.areas[0]?.areaId ?? "");
          setCategoryId(String(payload.data.categories[0]?.categoryId ?? ""));
        }
      })
      .catch(error => { if (!cancelled) setOptionsError(error instanceof Error ? error.message : "Unable to load report form."); })
      .finally(() => { if (!cancelled) setLoadingOptions(false); });
    return () => { cancelled = true; };
  }, []);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    setSubmission(null);
    try {
      const response = await fetch(`${API}/public/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areaId,
          categoryId: Number(categoryId),
          description,
          ...(reporterName.trim() ? { reporterName: reporterName.trim() } : {}),
          ...(reporterContact.trim() ? { reporterContact: reporterContact.trim() } : {})
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Report submission failed.");
      setSubmission(payload.data);
      setReportId(payload.data.reportId);
      setTrackingToken(payload.data.trackingToken);
      setDescription("");
      setReporterName("");
      setReporterContact("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Report submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function trackReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTracking(true);
    setTrackingError("");
    setStatus(null);
    try {
      const response = await fetch(`${API}/public/reports/${encodeURIComponent(reportId)}/status`, {
        headers: { "x-report-tracking-token": trackingToken }
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not find that report.");
      setStatus(payload.data);
    } catch (error) {
      setTrackingError(error instanceof Error ? error.message : "Could not retrieve report status.");
    } finally {
      setTracking(false);
    }
  }

  return (
    <section className="portal" id="report">
      <div className="portalIntro">
        <div className="eyebrow">Public reporting</div>
        <h2>See something that needs cleaning?</h2>
        <p>Send a report without creating an account. Your private tracking token is shown once after submission. Keep it safe.</p>
      </div>
      <div className="portalGrid">
        <form className="formCard" onSubmit={submitReport}>
          <h3>Submit a waste report</h3>
          {loadingOptions ? <p className="muted">Loading fest locations…</p> : null}
          {optionsError ? <p className="error" role="alert">{optionsError} Check that the API and PostgreSQL database are running.</p> : null}
          {!loadingOptions && !optionsError && options.areas.length === 0 ? <p className="muted">No active fest areas have been configured yet.</p> : null}
          <label>Area
            <select required value={areaId} onChange={event => setAreaId(event.target.value)} disabled={loadingOptions || options.areas.length === 0}>
              {options.areas.map(area => <option key={area.areaId} value={area.areaId}>{area.zoneName} — {area.areaName}</option>)}
            </select>
          </label>
          <label>Waste category
            <select required value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={loadingOptions || options.categories.length === 0}>
              {options.categories.map(category => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
            </select>
          </label>
          <label>Description
            <textarea required minLength={10} maxLength={3000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe what you found and where…" />
          </label>
          <div className="optionalGrid">
            <label>Name <span className="muted">(optional)</span>
              <input maxLength={120} value={reporterName} onChange={event => setReporterName(event.target.value)} placeholder="Your name" />
            </label>
            <label>Contact <span className="muted">(optional)</span>
              <input maxLength={254} value={reporterContact} onChange={event => setReporterContact(event.target.value)} placeholder="Email or phone" />
            </label>
          </div>
          <p className="privacyNote">No account is required. Name and contact are optional. Do not include sensitive personal information.</p>
          {submitError ? <p className="error" role="alert">{submitError}</p> : null}
          <button className="primaryButton" disabled={submitting || loadingOptions || options.areas.length === 0 || options.categories.length === 0}>
            {submitting ? "Submitting…" : "Submit report"}
          </button>
          {submission ? (
            <div className="successPanel" role="status">
              <strong>Report submitted</strong>
              <p>Report ID: <code>{submission.reportId}</code></p>
              <p>Your one-time tracking token:</p>
              <code className="token">{submission.trackingToken}</code>
              <p className="privacyNote">Copy and store this token now. It cannot be retrieved again from the system.</p>
            </div>
          ) : null}
        </form>

        <form className="formCard trackerCard" onSubmit={trackReport}>
          <h3>Track an existing report</h3>
          <p className="muted">Enter the report ID and the private token you received after submitting.</p>
          <label>Report ID
            <input required value={reportId} onChange={event => setReportId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </label>
          <label>Tracking token
            <input required value={trackingToken} onChange={event => setTrackingToken(event.target.value)} placeholder="Your private tracking token" />
          </label>
          {trackingError ? <p className="error" role="alert">{trackingError}</p> : null}
          <button className="secondaryButton" disabled={tracking}>{tracking ? "Checking…" : "Check status"}</button>
          {status ? (
            <div className="statusPanel" role="status">
              <span className="eyebrow">Current status</span>
              <strong>{status.status.replaceAll("_", " ")}</strong>
              <small>Submitted: {new Date(status.submitted_at).toLocaleString()}</small>
              <small>Last updated: {new Date(status.updated_at).toLocaleString()}</small>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
