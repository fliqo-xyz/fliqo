/* Visible questions and answers (the same list feeds the FAQPage structured data on the page). */
export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-[var(--line)]">
      {items.map((i) => (
        <details key={i.q} className="group py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-normal text-fg">
            {i.q}
            <span aria-hidden="true" className="text-lg text-muted group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-2 text-sm text-muted">{i.a}</p>
        </details>
      ))}
    </div>
  );
}
