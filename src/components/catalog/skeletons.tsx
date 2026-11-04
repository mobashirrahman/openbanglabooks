/** Loading shells: the same geometry as the real page, so nothing jumps when content arrives. */
function Bar({ className }: { className: string }) {
  return <div className={`animate-skeleton rounded-md bg-sunken ${className}`} />;
}

export function BookSkeleton() {
  return (
    <div aria-busy className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-16 pb-10 sm:grid-cols-[13rem_1fr] sm:gap-10 sm:px-6 lg:grid-cols-[16rem_1fr] lg:gap-14 lg:px-8">
        <div className="mx-auto aspect-[2/3] w-44 animate-skeleton rounded-[2px] bg-sunken sm:mx-0 sm:w-full" />
        <div className="space-y-4 pt-2">
          <Bar className="h-14 w-2/3" />
          <Bar className="h-6 w-1/3" />
          <Bar className="mt-8 h-12 w-48" />
        </div>
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div aria-busy className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
      <Bar className="h-12 w-1/3" />
      <Bar className="mt-3 h-5 w-1/2" />
      <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="aspect-[2/3] animate-skeleton rounded-[2px] bg-sunken" />
        ))}
      </div>
    </div>
  );
}
