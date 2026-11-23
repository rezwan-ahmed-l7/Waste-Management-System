import { AdminSetupForm } from "./setup-form";

export default function AdminSetupPage() {
  return <main className="authPage">
    <a className="authBrand" href="/">BAUST <span>GREEN</span> / CSE FEST</a>
    <AdminSetupForm />
  </main>;
}
