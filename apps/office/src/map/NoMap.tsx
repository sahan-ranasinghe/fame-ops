// Under the google package a page whose Google map is refused (a cap, the counter, a failed
// load) shows its lists without a map, and says why (Part 5).
export function NoMap({ note, small = false }: { note: string; small?: boolean }) {
  return (
    <div className={small ? "pinmap" : "mapbox ml"} data-testid="no-map" role="note">
      <div className="muted" style={{ padding: 24 }}>No map: {note}. The lists show everything.</div>
    </div>
  );
}
