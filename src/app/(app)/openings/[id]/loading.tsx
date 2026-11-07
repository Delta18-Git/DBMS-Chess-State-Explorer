// Shown instantly while a page's data loads, so every click gets immediate feedback.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="progress" />
      <div className="skeleton" style={{ width: 260, height: 28, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: 420, maxWidth: "100%", height: 16, marginBottom: 22 }} />
      <div className="skeleton" style={{ height: 86, marginBottom: 16 }} />
      <div className="grid grid-2">
        <div className="skeleton" style={{ height: 320 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </div>
  );
}
