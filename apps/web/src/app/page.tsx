const workflow = [
  ["01", "Report", "Submit a waste issue anonymously with its location, category, and an optional description."],
  ["02", "Coordinate", "The waste team reviews reports and assigns cleaning work to volunteers."],
  ["03", "Verify", "Collection evidence and measured weight are checked before totals are counted."],
  ["04", "Process", "Track segregation, recycling, reuse, composting, and disposal transparently."]
];

export default function HomePage() {
  return (
    <>
      <header className="header">
        <div className="container headerInner">
          <div className="brand">BAUST <span>GREEN</span> / CSE FEST</div>
          <nav className="nav" aria-label="Main navigation">
            <a href="#workflow">How it works</a>
            <a href="#responsibility">Our approach</a>
          </nav>
        </div>
      </header>
      <main className="container">
        <section className="hero">
          <div>
            <div className="eyebrow">A cleaner fest starts with a signal</div>
            <h1>Make every corner count.</h1>
            <p className="lead">A coordinated waste management system for BAUST CSE Fest — from the first report to verified collection and responsible processing.</p>
          </div>
          <aside className="panel" id="responsibility">
            <h2>Built around accountability</h2>
            <div className="steps">
              <div className="step"><span className="number">✓</span><p>Report a waste issue without creating an account.</p></div>
              <div className="step"><span className="number">✓</span><p>Track your report with a private one-time token.</p></div>
              <div className="step"><span className="number">✓</span><p>Count only manager-verified collection in official totals.</p></div>
            </div>
          </aside>
        </section>
        <section className="section" id="workflow">
          <div className="eyebrow">Operational workflow</div>
          <h2>From report to responsible processing.</h2>
          <div className="cards">
            {workflow.map(([number, title, description]) => (
              <article className="card" key={number}>
                <div className="eyebrow">{number}</div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer"><div className="container">BAUST CSE Fest Waste Management System · Responsible operations, measurable outcomes.</div></footer>
    </>
  );
}
