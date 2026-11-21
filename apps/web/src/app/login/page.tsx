import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="authPage">
      <a className="authBrand" href="/">BAUST <span>GREEN</span> / CSE FEST</a>
      <LoginForm />
    </main>
  );
}
