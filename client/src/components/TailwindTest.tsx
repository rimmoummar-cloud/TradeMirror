// Standalone Tailwind sanity-check component.
// Mount it anywhere (e.g. temporarily in a page) to visually confirm Tailwind
// utilities are being applied. Safe to delete once verified.
export function TailwindTest() {
  return (
    <div className="text-red-500 text-3xl font-bold">
      TAILWIND WORKING
    </div>
  );
}
